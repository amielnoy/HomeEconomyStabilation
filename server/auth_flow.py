"""Google sign-in, kept on this side of the boundary.

The browser is served under ``connect-src 'self'`` and is never given a Supabase
credential — ``cloud-sync.ts`` reaches this API with a bearer token and this API reaches
Supabase. Sign-in has to keep that shape, so the exchange happens here: the browser is sent
to a first-party route, this module talks to the provider, and only a session token comes
back. Loosening the policy or shipping the publishable key to the page would undo a
boundary the rest of the system is built around.

The flow is PKCE rather than implicit. The verifier stays in an httpOnly cookie for the
length of the round trip, so the code that comes back from the provider is worthless to
anyone who intercepts it, and no token is ever written into a URL the browser keeps in its
history.
"""

from __future__ import annotations

from base64 import urlsafe_b64encode
from dataclasses import dataclass
from hashlib import sha256
from secrets import token_urlsafe
from urllib.parse import urlencode, urlparse

from .config import SupabaseConfig

# Long enough that a stolen verifier is useless, short enough that an abandoned sign-in does
# not leave a usable cookie sitting in the browser for the rest of the day.
STATE_TTL_SECONDS = 600

VERIFIER_COOKIE = "he_pkce"
STATE_COOKIE = "he_state"


def _b64url(raw: bytes) -> str:
    return urlsafe_b64encode(raw).decode("ascii").rstrip("=")


@dataclass(frozen=True, slots=True)
class PkceChallenge:
    verifier: str
    challenge: str
    state: str


def create_challenge() -> PkceChallenge:
    """A fresh verifier, its S256 challenge, and a state value to tie the round trip."""
    verifier = token_urlsafe(64)
    challenge = _b64url(sha256(verifier.encode("ascii")).digest())
    return PkceChallenge(verifier=verifier, challenge=challenge, state=token_urlsafe(32))


def authorize_url(config: SupabaseConfig, challenge: PkceChallenge, redirect_to: str) -> str:
    """Where to send the browser to sign in with Google."""
    query = urlencode(
        {
            "provider": "google",
            "redirect_to": redirect_to,
            "code_challenge": challenge.challenge,
            "code_challenge_method": "s256",
            "state": challenge.state,
        }
    )
    return f"{config.url}/auth/v1/authorize?{query}"


def is_allowed_redirect(target: str, allowed_origins: frozenset[str]) -> bool:
    """Only this deployment's own origins may be returned to.

    An open redirect here would let a crafted link carry a real session to somebody else's
    page, which is the whole account rather than one request.
    """
    if target.startswith("/") and not target.startswith("//"):
        return True
    parsed = urlparse(target)
    if parsed.scheme != "https" or not parsed.netloc:
        return False
    return f"https://{parsed.netloc}" in allowed_origins


def allowed_origins(env: dict[str, str]) -> frozenset[str]:
    """Origins this deployment answers on, from ``AUTH_ALLOWED_ORIGINS``."""
    raw = env.get("AUTH_ALLOWED_ORIGINS", "")
    origins = set()
    for candidate in raw.split(","):
        cleaned = candidate.strip().rstrip("/")
        parsed = urlparse(cleaned)
        if parsed.scheme == "https" and parsed.netloc and not parsed.username:
            origins.add(f"https://{parsed.netloc}")
    return frozenset(origins)


@dataclass(frozen=True, slots=True)
class Session:
    access_token: str
    refresh_token: str
    expires_in: int


def parse_session(payload: object) -> Session | None:
    """A provider response is only a session when it carries a usable pair of tokens."""
    if not isinstance(payload, dict):
        return None
    access = payload.get("access_token")
    refresh = payload.get("refresh_token")
    expires = payload.get("expires_in")
    if not isinstance(access, str) or not access or not isinstance(refresh, str) or not refresh:
        return None
    if not isinstance(expires, int) or expires <= 0:
        return None
    # Bounded so a hostile response cannot pin a session open for years.
    return Session(access_token=access, refresh_token=refresh, expires_in=min(expires, 24 * 3600))
