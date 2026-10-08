from __future__ import annotations

import json

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool

from .auth_flow import create_challenge
from .http_auth import SESSION_COOKIE, authenticated_client
from .open_banking_config import client_id_for, licence_id, read_sources, sandbox_enabled
from .open_banking_flow import OpenBankingRefreshRefused, authorize_url, exchange_code, refresh_tokens
from .open_banking_store import OpenBankingRepository
from .open_banking_sync import pull_transactions
from .supabase_store import ConsentRepository, SupabaseDataError

router = APIRouter()

OPEN_BANKING_CONSENT_VERSION = "open-banking-v1-read-only-2026-10-07"
STATE_COOKIE = "he_ob_state"
VERIFIER_COOKIE = "he_ob_pkce"
SOURCE_COOKIE = "he_ob_source"
STATE_TTL_SECONDS = 600
_DEFAULT_LANDING_PATH = "/mazan-habait.html"


def _error(status: int, code: str) -> JSONResponse:
    return JSONResponse({"code": code}, status_code=status)


def _error_code(response: JSONResponse) -> str:
    return json.loads(response.body)["code"]


def _source_or_none(source_id: str):
    return next((source for source in read_sources() if source.id == source_id), None)


def _callback_exit(target: str, *, error: str | None = None) -> Response:
    # Unlike Google sign-in, nothing here carries a caller-supplied `next` target — the
    # landing page is fixed, so there is no open-redirect surface to check. Every exit
    # from this route is a redirect, success included, and every exit clears all three
    # PKCE cookies — they were only ever meant to survive the single round trip to the
    # bank and back.
    url = f"{target}?openBankingError={error}" if error else target
    response = RedirectResponse(url, status_code=302)
    for cookie in (VERIFIER_COOKIE, STATE_COOKIE, SOURCE_COOKIE):
        response.delete_cookie(cookie, path="/")
    return response


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

    # `connect` and `sync` require both an authenticated session and an active
    # `open_banking` consent, exactly as `/api/snapshots` requires active `cloud_sync`
    # consent today — mirrors sync's own auth-then-consent gate below.
    authenticated = await authenticated_client(request)
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
        return _callback_exit(_DEFAULT_LANDING_PATH, error="open_banking_state_mismatch")
    source = _source_or_none(source_id)
    client_id = client_id_for(source_id) if source else None
    if not source or not client_id:
        return _callback_exit(_DEFAULT_LANDING_PATH, error="open_banking_not_configured")
    # Re-checked here, not just at `connect` time: the gate must hold for every outbound
    # call against a non-sandbox source, not only the first one that created the cookies.
    if not sandbox_enabled() and not licence_id():
        return _callback_exit(_DEFAULT_LANDING_PATH, error="open_banking_not_configured")

    redirect_uri = f"{request.url.scheme}://{request.url.netloc}/api/open-banking/callback"
    pair = await run_in_threadpool(exchange_code, source, client_id, code, verifier, redirect_uri)
    if pair is None:
        return _callback_exit(_DEFAULT_LANDING_PATH, error="open_banking_exchange_failed")

    authenticated = await authenticated_client(request)
    if isinstance(authenticated, JSONResponse):
        return _callback_exit(_DEFAULT_LANDING_PATH, error=_error_code(authenticated))
    client, user_id = authenticated
    repository = OpenBankingRepository(client, user_id)
    try:
        await run_in_threadpool(repository.create_connection, source_id, pair.refresh_token)
    except SupabaseDataError:
        return _callback_exit(_DEFAULT_LANDING_PATH, error="open_banking_connection_failed")

    return _callback_exit(_DEFAULT_LANDING_PATH)


@router.get("/api/open-banking/connections")
async def connections(request: Request) -> Response:
    authenticated = await authenticated_client(request)
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
    authenticated = await authenticated_client(request)
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
        # Re-checked on every sync, not just at connection-creation time: a connection
        # created while sandboxed/licensed must stop syncing the moment that configuration
        # is withdrawn.
        if not sandbox_enabled() and not licence_id():
            return _error(503, "open_banking_not_configured")

        stored_refresh_token = await run_in_threadpool(repository.read_refresh_token, connection_id)
        if not stored_refresh_token:
            return _error(502, "open_banking_token_missing")
        try:
            pair = await run_in_threadpool(refresh_tokens, source, client_id, stored_refresh_token)
        except OpenBankingRefreshRefused:
            # The bank definitively refusing the refresh (400/401) is exactly what "consent
            # expired or withdrawn" looks like from this app's side: revoke immediately
            # rather than leaving a connection that looks active but can never sync again.
            await run_in_threadpool(repository.revoke, connection_id)
            return _error(502, "open_banking_refresh_failed")
        if pair is None:
            # A transient failure (network error, timeout, 5xx, malformed body) is not a
            # revocation: the connection stays active so the next sync can simply retry,
            # rather than forcing the user to re-consent at the bank after a network blip.
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
    authenticated = await authenticated_client(request)
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
    authenticated = await authenticated_client(request)
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
