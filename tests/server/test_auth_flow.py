from base64 import urlsafe_b64encode
from hashlib import sha256
from urllib.parse import parse_qs, urlparse

from server.auth_flow import (
    Session,
    allowed_origins,
    authorize_url,
    create_challenge,
    is_allowed_redirect,
    parse_session,
)
from server.config import SupabaseConfig

CONFIG = SupabaseConfig(url="https://project.supabase.co", publishable_key="sb_publishable_x")


def test_the_challenge_is_the_hash_of_the_verifier_the_browser_never_sees() -> None:
    """PKCE is what makes an intercepted code worthless; the verifier stays on this side."""
    challenge = create_challenge()

    expected = urlsafe_b64encode(sha256(challenge.verifier.encode("ascii")).digest()).decode().rstrip("=")
    assert challenge.challenge == expected
    assert challenge.challenge != challenge.verifier
    assert len(challenge.verifier) >= 43


def test_two_sign_ins_never_share_a_verifier_or_a_state() -> None:
    first, second = create_challenge(), create_challenge()

    assert first.verifier != second.verifier
    assert first.state != second.state


def test_the_authorize_url_asks_google_through_the_project_and_carries_the_challenge() -> None:
    challenge = create_challenge()

    url = authorize_url(CONFIG, challenge, "https://app.example/mazan-habait.html")

    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    assert parsed.netloc == "project.supabase.co"
    assert parsed.path == "/auth/v1/authorize"
    assert query["provider"] == ["google"]
    assert query["code_challenge"] == [challenge.challenge]
    assert query["code_challenge_method"] == ["s256"]
    assert query["state"] == [challenge.state]
    # The verifier itself must never leave this process.
    assert challenge.verifier not in url


def test_only_this_deployments_origins_may_be_returned_to() -> None:
    """An open redirect here hands a real session to somebody else's page."""
    origins = frozenset({"https://home-economy-stabilation.vercel.app"})

    assert is_allowed_redirect("/mazan-habait.html", origins) is True
    assert is_allowed_redirect("https://home-economy-stabilation.vercel.app/x", origins) is True
    assert is_allowed_redirect("https://evil.example/steal", origins) is False
    assert is_allowed_redirect("//evil.example/steal", origins) is False
    assert is_allowed_redirect("http://home-economy-stabilation.vercel.app", origins) is False
    assert is_allowed_redirect("javascript:alert(1)", origins) is False


def test_allowed_origins_takes_only_https_origins_from_the_environment() -> None:
    origins = allowed_origins(
        {"AUTH_ALLOWED_ORIGINS": "https://a.example/, http://b.example, https://c.example, junk"}
    )

    assert origins == frozenset({"https://a.example", "https://c.example"})


def test_a_response_without_both_tokens_is_not_a_session() -> None:
    assert parse_session({"access_token": "a", "expires_in": 3600}) is None
    assert parse_session({"refresh_token": "r", "expires_in": 3600}) is None
    assert parse_session({"access_token": "a", "refresh_token": "r"}) is None
    assert parse_session({"access_token": "", "refresh_token": "r", "expires_in": 60}) is None
    assert parse_session("not-a-mapping") is None


def test_a_session_lifetime_is_bounded_whatever_the_provider_claims() -> None:
    """A hostile or misconfigured response must not pin a session open for years."""
    session = parse_session({"access_token": "a", "refresh_token": "r", "expires_in": 10_000_000})

    assert session == Session(access_token="a", refresh_token="r", expires_in=24 * 3600)
