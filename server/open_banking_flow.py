from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from .auth_flow import PkceChallenge
from .open_banking_config import OpenBankingSource


def authorize_url(source: OpenBankingSource, client_id: str, challenge: PkceChallenge, redirect_uri: str) -> str:
    query = urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "code_challenge": challenge.challenge,
        "code_challenge_method": "S256",
        "state": challenge.state,
    })
    return f"{source.authorization_url}?{query}"


@dataclass(frozen=True, slots=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int


def parse_token_response(payload: object) -> TokenPair | None:
    if not isinstance(payload, dict):
        return None
    access = payload.get("access_token")
    refresh = payload.get("refresh_token")
    expires = payload.get("expires_in")
    if not isinstance(access, str) or not access or not isinstance(refresh, str) or not refresh:
        return None
    if not isinstance(expires, (int, float)) or expires <= 0:
        return None
    # Bounded for the same reason a Google session is: a hostile or misconfigured
    # response must not pin a token open for longer than this process is willing to trust it.
    return TokenPair(access_token=access, refresh_token=refresh, expires_in=min(int(expires), 24 * 3600))


class OpenBankingRefreshRefused(Exception):
    """The bank definitively refused a refresh grant (HTTP 400 or 401).

    RFC 6749 §5.2 answers a dead grant (`invalid_grant`: the consent expired or was
    withdrawn at the bank) with a 400, and a rejected client with a 401. Either way the
    stored refresh token will never work again, so this — and only this — is grounds to
    revoke the connection. Everything else that can go wrong (network error, timeout, a
    5xx, a body that is not a usable token response) is transient and must not revoke.
    """

    def __init__(self, status_code: int) -> None:
        super().__init__(f"Open Banking refresh refused with HTTP {status_code}")
        self.status_code = status_code


_REFUSAL_STATUSES = frozenset({400, 401})


def _post_for_tokens(source: OpenBankingSource, data: dict, *, raise_on_refusal: bool = False) -> TokenPair | None:
    """Exchange POST request data for tokens, with error handling and JSON guard.

    Handles network errors, non-200 responses, and malformed JSON responses by
    returning None (fail-closed). With `raise_on_refusal`, a definitive 400/401 refusal
    raises OpenBankingRefreshRefused instead, so a caller can tell it apart from a
    transient failure; without it, every failure is the same None.
    """
    try:
        response = httpx.post(
            source.token_url,
            data=data,
            timeout=8.0,
        )
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        if raise_on_refusal and response.status_code in _REFUSAL_STATUSES:
            raise OpenBankingRefreshRefused(response.status_code)
        return None
    try:
        return parse_token_response(response.json())
    except ValueError:
        # Malformed JSON (200 response with non-JSON body, truncated body, etc)
        return None


def exchange_code(
    source: OpenBankingSource, client_id: str, code: str, verifier: str, redirect_uri: str,
) -> TokenPair | None:
    return _post_for_tokens(
        source,
        {
            "grant_type": "authorization_code", "code": code, "code_verifier": verifier,
            "redirect_uri": redirect_uri, "client_id": client_id,
        },
    )


def refresh_tokens(source: OpenBankingSource, client_id: str, refresh_token: str) -> TokenPair | None:
    """Returns a fresh pair, or None on a transient failure (network error, timeout,
    5xx, malformed body) worth retrying on the next sync.

    Raises OpenBankingRefreshRefused when the bank definitively refuses the grant
    (HTTP 400/401) — the only outcome that means the connection is dead.
    """
    return _post_for_tokens(
        source,
        {"grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": client_id},
        raise_on_refusal=True,
    )
