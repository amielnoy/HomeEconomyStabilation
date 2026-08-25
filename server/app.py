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
from .models import CloudConsentInput, ConsentAcceptance, ProfileInput, SnapshotInput, UserProfile
from .request_guard import GuardFailure, SnapshotRequestGuard
from .supabase_store import (
    ConsentRepository,
    SnapshotRepository,
    SupabaseDataError,
    SupabaseRestClient,
    UserProfileRepository,
)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_guard = SnapshotRequestGuard()
_rate_salt = token_bytes(32)
CLOUD_CONSENT_VERSION = "cloud-sync-v2-privacy-minimised-2026-08-24"
_SMALL_BODY_LIMIT = 1_024


def _error(status: int, code: str, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"code": code}, status_code=status, headers=headers)


def _retry_after(failure: GuardFailure) -> dict[str, str] | None:
    return {"Retry-After": str(failure.retry_after)} if failure.retry_after else None


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-vercel-forwarded-for") or request.headers.get("x-forwarded-for") or "unknown"
    address = forwarded.split(",", maxsplit=1)[0].strip()[:100]
    return sha256(_rate_salt + address.encode("utf-8")).hexdigest()


async def _authenticated_client(request: Request) -> tuple[SupabaseRestClient, str] | JSONResponse:
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
    return client, user_id


async def _small_json_body(request: Request, model: type[ProfileInput] | type[CloudConsentInput]):
    if not (request.headers.get("content-type") or "").lower().startswith("application/json"):
        return _error(415, "json_content_type_required")
    raw_body = await request.body()
    if len(raw_body) > _SMALL_BODY_LIMIT:
        return _error(413, "request_too_large")
    try:
        return model.model_validate_json(raw_body)
    except (ValidationError, ValueError):
        return _error(400, "invalid_request")


def _profile_json(profile: UserProfile | None) -> dict[str, object] | None:
    if not profile:
        return None
    return {
        "preferredLocale": profile.preferred_locale,
        "createdAt": profile.created_at.isoformat(),
        "updatedAt": profile.updated_at.isoformat(),
    }


def _consent_json(consent: ConsentAcceptance | None) -> dict[str, object] | None:
    if not consent:
        return None
    return {
        "purpose": consent.purpose,
        "statementVersion": consent.statement_version,
        "locale": consent.locale,
        "acceptedAt": consent.accepted_at.isoformat(),
        "withdrawnAt": consent.withdrawn_at.isoformat() if consent.withdrawn_at else None,
    }


@app.middleware("http")
async def response_contract(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    record_response(request.method, request.url.path, response.status_code)
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
        return _error(failure.status, failure.code, _retry_after(failure))

    # Size is cheap to check and bounds the read; parsing is not, so it waits until
    # the caller has proved who they are.
    raw_body = b""
    if request.method == "PUT":
        raw_body = await request.body()
        if len(raw_body) > 1_010_000:
            return _error(413, "snapshot_too_large")

    authenticated = await _authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return authenticated
    client, user_id = authenticated

    snapshot_input: SnapshotInput | None = None
    if request.method == "PUT":
        try:
            snapshot_input = SnapshotInput.model_validate_json(raw_body)
            if len(snapshot_input.payload.model_dump_json(by_alias=True).encode("utf-8")) > 1_000_000:
                return _error(413, "snapshot_too_large")
        except (ValidationError, ValueError):
            return _error(400, "invalid_snapshot")

    repository = SnapshotRepository(client, user_id)

    try:
        if request.method == "GET":
            snapshot = await run_in_threadpool(repository.read)
            return JSONResponse({"snapshot": asdict(snapshot) if snapshot else None})
        if request.method == "DELETE":
            await run_in_threadpool(repository.delete)
            return Response(status_code=204)
        assert snapshot_input is not None
        consent = await run_in_threadpool(ConsentRepository(client, user_id).read, CLOUD_CONSENT_VERSION)
        if not consent or consent.withdrawn_at is not None:
            return _error(403, "cloud_consent_required")
        snapshot = await run_in_threadpool(repository.save, snapshot_input.payload)
        return JSONResponse({"snapshot": asdict(snapshot)})
    except SupabaseDataError as cause:
        code = (
            "cloud_read_failed" if cause.operation == "snapshot_read" else
            "cloud_delete_failed" if cause.operation == "snapshot_delete" else
            "cloud_consent_check_failed" if cause.operation == "consent_read" else
            "cloud_write_failed"
        )
        return _error(502, code)


@app.api_route("/api/profile", methods=["GET", "PUT", "POST", "PATCH", "DELETE", "OPTIONS"])
async def profile(request: Request) -> Response:
    if request.method not in {"GET", "PUT"}:
        return _error(405, "method_not_allowed", {"Allow": "GET, PUT"})
    failure = _guard.rate_limit_only(client_key=_client_key(request))
    if failure:
        return _error(failure.status, failure.code, _retry_after(failure))
    profile_input = await _small_json_body(request, ProfileInput) if request.method == "PUT" else None
    if isinstance(profile_input, JSONResponse):
        return profile_input
    authenticated = await _authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return authenticated
    client, user_id = authenticated
    repository = UserProfileRepository(client, user_id)
    try:
        value = await run_in_threadpool(repository.read) if request.method == "GET" else await run_in_threadpool(
            repository.save, profile_input.preferred_locale  # type: ignore[union-attr]
        )
        return JSONResponse({"profile": _profile_json(value)})
    except SupabaseDataError as cause:
        return _error(502, "cloud_profile_read_failed" if cause.operation == "profile_read" else "cloud_profile_write_failed")


@app.api_route("/api/consents/cloud-sync", methods=["GET", "PUT", "DELETE", "POST", "PATCH", "OPTIONS"])
async def cloud_consent(request: Request) -> Response:
    if request.method not in {"GET", "PUT", "DELETE"}:
        return _error(405, "method_not_allowed", {"Allow": "GET, PUT, DELETE"})
    failure = _guard.rate_limit_only(client_key=_client_key(request))
    if failure:
        return _error(failure.status, failure.code, _retry_after(failure))
    consent_input = await _small_json_body(request, CloudConsentInput) if request.method == "PUT" else None
    if isinstance(consent_input, JSONResponse):
        return consent_input
    authenticated = await _authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return authenticated
    client, user_id = authenticated
    repository = ConsentRepository(client, user_id)
    try:
        if request.method == "GET":
            value = await run_in_threadpool(repository.read, CLOUD_CONSENT_VERSION)
        elif request.method == "PUT":
            value = await run_in_threadpool(
                repository.accept, CLOUD_CONSENT_VERSION, consent_input.locale  # type: ignore[union-attr]
            )
        else:
            current = await run_in_threadpool(repository.read, CLOUD_CONSENT_VERSION)
            if not current:
                return Response(status_code=204)
            await run_in_threadpool(repository.withdraw, CLOUD_CONSENT_VERSION)
            return Response(status_code=204)
        return JSONResponse({"consent": _consent_json(value)})
    except SupabaseDataError as cause:
        code = "cloud_consent_read_failed" if cause.operation == "consent_read" else "cloud_consent_write_failed"
        return _error(502, code)
