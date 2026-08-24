from __future__ import annotations

from dataclasses import asdict
from hashlib import sha256
from secrets import token_bytes

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from .config import bearer_token, read_supabase_config
from .metrics import record_response, render_metrics
from .models import SnapshotInput
from .request_guard import SnapshotRequestGuard
from .supabase_store import SnapshotRepository, SupabaseDataError, SupabaseRestClient

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_guard = SnapshotRequestGuard()
_rate_salt = token_bytes(32)


def _error(status: int, code: str, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"code": code}, status_code=status, headers=headers)


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-vercel-forwarded-for") or request.headers.get("x-forwarded-for") or "unknown"
    address = forwarded.split(",", maxsplit=1)[0].strip()[:100]
    return sha256(_rate_salt + address.encode("utf-8")).hexdigest()


@app.middleware("http")
async def response_contract(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    record_response(request.method, response.status_code)
    return response


@app.api_route("/api/health", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
async def public_health(request: Request) -> Response:
    if request.method not in {"GET", "HEAD"}:
        return _error(405, "method_not_allowed", {"Allow": "GET, HEAD"})
    if request.method == "HEAD":
        return Response(status_code=200)
    return JSONResponse({"status": "ok", "service": "home-economy-api"})


@app.get("/health")
async def container_health() -> PlainTextResponse:
    return PlainTextResponse("ok")


@app.get("/metrics")
async def metrics() -> PlainTextResponse:
    return PlainTextResponse(await run_in_threadpool(render_metrics), media_type="text/plain; version=0.0.4")


@app.api_route("/api/snapshots", methods=["GET", "PUT", "DELETE", "POST", "PATCH", "OPTIONS"])
async def snapshots(request: Request) -> Response:
    if request.method not in {"GET", "PUT", "DELETE"}:
        return _error(405, "method_not_allowed", {"Allow": "GET, PUT, DELETE"})

    failure = _guard.check(
        method=request.method,
        client_key=_client_key(request),
        content_type=request.headers.get("content-type"),
        content_length=request.headers.get("content-length"),
    )
    if failure:
        headers = {"Retry-After": str(failure.retry_after)} if failure.retry_after else None
        return _error(failure.status, failure.code, headers)

    snapshot_input: SnapshotInput | None = None
    if request.method == "PUT":
        raw_body = await request.body()
        if len(raw_body) > 1_010_000:
            return _error(413, "snapshot_too_large")
        try:
            snapshot_input = SnapshotInput.model_validate_json(raw_body)
            if len(snapshot_input.payload.model_dump_json(by_alias=True).encode("utf-8")) > 1_000_000:
                return _error(413, "snapshot_too_large")
        except (ValidationError, ValueError):
            return _error(400, "invalid_snapshot")

    config = read_supabase_config()
    if not config:
        return _error(503, "cloud_not_configured")
    token = bearer_token(request.headers.get("authorization"))
    if not token:
        return _error(401, "authentication_required")

    client = SupabaseRestClient(config, token)
    user_id = await run_in_threadpool(client.verify_user)
    if not user_id:
        return _error(401, "invalid_session")
    repository = SnapshotRepository(client, user_id)

    try:
        if request.method == "GET":
            snapshot = await run_in_threadpool(repository.read)
            return JSONResponse({"snapshot": asdict(snapshot) if snapshot else None})
        if request.method == "DELETE":
            await run_in_threadpool(repository.delete)
            return Response(status_code=204)
        assert snapshot_input is not None
        snapshot = await run_in_threadpool(repository.save, snapshot_input.payload)
        return JSONResponse({"snapshot": asdict(snapshot)})
    except SupabaseDataError as cause:
        code = "cloud_read_failed" if cause.operation == "snapshot_read" else (
            "cloud_delete_failed" if cause.operation == "snapshot_delete" else "cloud_write_failed"
        )
        return _error(502, code)
