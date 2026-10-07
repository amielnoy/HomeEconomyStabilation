from __future__ import annotations

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool

from .auth_flow import create_challenge
from .config import bearer_token
from .open_banking_config import client_id_for, licence_id, read_sources, sandbox_enabled
from .open_banking_flow import authorize_url, exchange_code, refresh_tokens
from .open_banking_store import OpenBankingRepository
from .open_banking_sync import pull_transactions
from .supabase_store import ConsentRepository, SupabaseDataError

router = APIRouter()

OPEN_BANKING_CONSENT_VERSION = "open-banking-v1-read-only-2026-10-07"
STATE_COOKIE = "he_ob_state"
VERIFIER_COOKIE = "he_ob_pkce"
SOURCE_COOKIE = "he_ob_source"
STATE_TTL_SECONDS = 600


def _error(status: int, code: str) -> JSONResponse:
    return JSONResponse({"code": code}, status_code=status)


def _source_or_none(source_id: str):
    return next((source for source in read_sources() if source.id == source_id), None)


async def _authenticated_client(request: Request):
    # Imported lazily (rather than `from .config import read_supabase_config` /
    # `from .supabase_store import SupabaseRestClient` at module scope) so this helper reads
    # through the *same* module attributes app.py's own `_authenticated_client` reads
    # through, and so this module can be imported by app.py without a circular import at
    # load time: `app.py` is only fully initialised by the time a request actually arrives.
    from . import app as app_module

    config = app_module.read_supabase_config()
    if not config:
        return _error(503, "cloud_not_configured")
    token = bearer_token(request.headers.get("authorization"))
    if not token:
        return _error(401, "authentication_required")
    client = app_module.SupabaseRestClient(config, token)
    user_id = await run_in_threadpool(client.verify_user)
    if not user_id:
        return _error(401, "invalid_session")
    return client, user_id


@router.get("/api/open-banking/sources")
async def sources() -> Response:
    mode = "sandbox" if sandbox_enabled() else ("production" if licence_id() else "unavailable")
    return JSONResponse({"sources": [
        {"id": s.id, "name": s.name, "kind": s.kind, "mode": mode} for s in read_sources()
    ]})


@router.get("/api/open-banking/connect/{source_id}")
async def connect(source_id: str, request: Request) -> Response:
    source = _source_or_none(source_id)
    if not source:
        return _error(404, "open_banking_source_not_found")
    if not sandbox_enabled() and not licence_id():
        return _error(503, "open_banking_not_configured")
    client_id = client_id_for(source_id)
    if not client_id:
        return _error(503, "open_banking_not_configured")

    challenge = create_challenge()
    redirect_uri = f"{request.url.scheme}://{request.url.netloc}/api/open-banking/callback"
    response = RedirectResponse(authorize_url(source, client_id, challenge, redirect_uri), status_code=302)
    response.set_cookie(VERIFIER_COOKIE, challenge.verifier, max_age=STATE_TTL_SECONDS, httponly=True, secure=True, samesite="lax", path="/")
    response.set_cookie(STATE_COOKIE, challenge.state, max_age=STATE_TTL_SECONDS, httponly=True, secure=True, samesite="lax", path="/")
    response.set_cookie(SOURCE_COOKIE, source_id, max_age=STATE_TTL_SECONDS, httponly=True, secure=True, samesite="lax", path="/")
    return response


@router.get("/api/open-banking/callback")
async def callback(request: Request) -> Response:
    source_id = request.cookies.get(SOURCE_COOKIE)
    verifier = request.cookies.get(VERIFIER_COOKIE)
    state = request.cookies.get(STATE_COOKIE)
    code = request.query_params.get("code")
    if not source_id or not verifier or not state or not code or state != request.query_params.get("state"):
        return _error(400, "open_banking_state_mismatch")
    source = _source_or_none(source_id)
    client_id = client_id_for(source_id) if source else None
    if not source or not client_id:
        return _error(503, "open_banking_not_configured")

    redirect_uri = f"{request.url.scheme}://{request.url.netloc}/api/open-banking/callback"
    pair = await run_in_threadpool(exchange_code, source, client_id, code, verifier, redirect_uri)
    if pair is None:
        return _error(502, "open_banking_exchange_failed")

    authenticated = await _authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return authenticated
    client, user_id = authenticated
    repository = OpenBankingRepository(client, user_id)
    try:
        await run_in_threadpool(repository.create_connection, source_id, pair.refresh_token)
    except SupabaseDataError:
        return _error(502, "open_banking_connection_failed")

    # Unlike Google sign-in, nothing here carries a caller-supplied `next` target — the
    # landing page is fixed, so there is no open-redirect surface to check.
    response = RedirectResponse("/mazan-habait.html", status_code=302)
    for cookie in (VERIFIER_COOKIE, STATE_COOKIE, SOURCE_COOKIE):
        response.delete_cookie(cookie, path="/")
    return response


@router.get("/api/open-banking/connections")
async def connections(request: Request) -> Response:
    authenticated = await _authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return authenticated
    client, user_id = authenticated
    repository = OpenBankingRepository(client, user_id)
    try:
        rows = await run_in_threadpool(repository.list_connections)
    except SupabaseDataError:
        return _error(502, "open_banking_connections_read_failed")
    return JSONResponse({"connections": [
        {"id": c.id, "sourceId": c.source_id, "status": c.status, "createdAt": c.created_at} for c in rows
    ]})


@router.post("/api/open-banking/sync/{connection_id}")
async def sync(connection_id: str, request: Request) -> Response:
    authenticated = await _authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return authenticated
    client, user_id = authenticated

    try:
        consent = await run_in_threadpool(
            ConsentRepository(client, user_id, purpose="open_banking").read, OPEN_BANKING_CONSENT_VERSION,
        )
    except SupabaseDataError:
        return _error(502, "open_banking_consent_check_failed")
    if not consent or consent.withdrawn_at is not None:
        return _error(403, "open_banking_consent_required")

    repository = OpenBankingRepository(client, user_id)
    try:
        target = next((c for c in await run_in_threadpool(repository.list_connections) if c.id == connection_id), None)
        if not target:
            return _error(404, "open_banking_connection_not_found")
        source = _source_or_none(target.source_id)
        client_id = client_id_for(target.source_id) if source else None
        if not source or not client_id:
            return _error(503, "open_banking_not_configured")

        stored_refresh_token = await run_in_threadpool(repository.read_refresh_token, connection_id)
        if not stored_refresh_token:
            return _error(502, "open_banking_token_missing")
        pair = await run_in_threadpool(refresh_tokens, source, client_id, stored_refresh_token)
        if pair is None:
            return _error(502, "open_banking_refresh_failed")
        await run_in_threadpool(repository.replace_refresh_token, connection_id, pair.refresh_token)
    except SupabaseDataError:
        return _error(502, "open_banking_sync_failed")

    # pull_transactions (Task 7) already turns a network failure or non-200 response into
    # an empty list rather than raising, so an empty sync result and a failed one are the
    # same thing here — there is nothing further to catch.
    rows = await run_in_threadpool(pull_transactions, source, pair.access_token)
    return JSONResponse({"transactions": [row.model_dump(by_alias=True, exclude_none=True) for row in rows]})


@router.delete("/api/open-banking/connections/{connection_id}")
async def revoke(connection_id: str, request: Request) -> Response:
    authenticated = await _authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return authenticated
    client, user_id = authenticated
    repository = OpenBankingRepository(client, user_id)
    try:
        await run_in_threadpool(repository.revoke, connection_id)
    except SupabaseDataError:
        return _error(502, "open_banking_revoke_failed")
    return Response(status_code=204)


@router.put("/api/consents/open-banking")
async def accept_consent(request: Request) -> Response:
    from .app import _small_json_body
    from .models import CloudConsentInput

    consent_input = await _small_json_body(request, CloudConsentInput)
    if isinstance(consent_input, JSONResponse):
        return consent_input
    authenticated = await _authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return authenticated
    client, user_id = authenticated
    try:
        value = await run_in_threadpool(
            ConsentRepository(client, user_id, purpose="open_banking").accept,
            OPEN_BANKING_CONSENT_VERSION, consent_input.locale,  # type: ignore[union-attr]
        )
    except SupabaseDataError:
        return _error(502, "open_banking_consent_write_failed")
    return JSONResponse({"consent": {
        "purpose": value.purpose, "statementVersion": value.statement_version, "locale": value.locale,
        "acceptedAt": value.accepted_at.isoformat(),
        "withdrawnAt": value.withdrawn_at.isoformat() if value.withdrawn_at else None,
    }})
