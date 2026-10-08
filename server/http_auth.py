from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .config import bearer_token, read_supabase_config, session_token
from .supabase_store import SupabaseRestClient

SESSION_COOKIE = "he_session"


def _error(status: int, code: str) -> JSONResponse:
    return JSONResponse({"code": code}, status_code=status)


async def authenticated_client(request: Request) -> tuple[SupabaseRestClient, str] | JSONResponse:
    config = read_supabase_config()
    if not config:
        return _error(503, "cloud_not_configured")
    token = bearer_token(request.headers.get("authorization")) or session_token(request.cookies.get(SESSION_COOKIE))
    if not token:
        return _error(401, "authentication_required")
    client = SupabaseRestClient(config, token)
    user_id = await run_in_threadpool(client.verify_user)
    if not user_id:
        return _error(401, "invalid_session")
    return client, user_id
