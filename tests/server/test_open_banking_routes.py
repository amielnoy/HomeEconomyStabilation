import httpx
import pytest
from fastapi.testclient import TestClient

import server.app as app_module
import server.http_auth as http_auth_module
import server.open_banking_routes as routes_module
from server.app import app
from server.open_banking_config import OpenBankingSource
from server.open_banking_flow import TokenPair
from server.open_banking_store import OpenBankingConnection

client = TestClient(app)

SOURCE = OpenBankingSource(
    id="hapoalim", kind="bank", name="בנק הפועלים",
    base_url="https://api.poalimdev.co.il/psd2/sandbox",
    authorization_url="https://api.poalimdev.co.il/oauth/authorize",
    token_url="https://api.poalimdev.co.il/oauth/token",
)


def test_sources_lists_nothing_when_unconfigured(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [])
    response = client.get("/api/open-banking/sources")
    assert response.status_code == 200
    assert response.json() == {"sources": []}


def test_sources_marks_each_source_sandbox_or_production(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: True)
    monkeypatch.setattr(routes_module, "licence_id", lambda: None)
    response = client.get("/api/open-banking/sources")
    assert response.json() == {"sources": [{"id": "hapoalim", "name": "בנק הפועלים", "kind": "bank", "mode": "sandbox"}]}


def test_connect_refuses_a_non_sandbox_call_without_a_licence(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: False)
    monkeypatch.setattr(routes_module, "licence_id", lambda: None)
    response = client.get("/api/open-banking/connect/hapoalim", follow_redirects=False)
    assert response.status_code == 503
    assert response.json() == {"code": "open_banking_not_configured"}


class FakeAuthenticatedClient:
    def verify_user(self) -> str:
        return "user-1"


def authenticate(monkeypatch) -> None:
    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(http_auth_module, "SupabaseRestClient", lambda _config, _token: FakeAuthenticatedClient())


def grant_open_banking_consent(monkeypatch) -> None:
    monkeypatch.setattr(
        routes_module, "ConsentRepository",
        lambda client, user_id, purpose="cloud_sync": type("C", (), {
            "read": lambda self, version: type("A", (), {"withdrawn_at": None})(),
        })(),
    )


def test_connect_redirects_to_the_sources_authorize_url_in_sandbox_mode(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: True)
    monkeypatch.setattr(routes_module, "licence_id", lambda: None)
    monkeypatch.setattr(routes_module, "client_id_for", lambda source_id: "client-abc")
    authenticate(monkeypatch)
    grant_open_banking_consent(monkeypatch)
    response = client.get(
        "/api/open-banking/connect/hapoalim", follow_redirects=False,
        headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 302
    assert response.headers["location"].startswith(SOURCE.authorization_url)


def test_connect_with_an_unknown_source_id_is_not_found(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: True)
    response = client.get("/api/open-banking/connect/unknown", follow_redirects=False)
    assert response.status_code == 404


def test_connect_requires_authentication_even_when_sandboxed(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: True)
    monkeypatch.setattr(routes_module, "licence_id", lambda: None)
    monkeypatch.setattr(routes_module, "client_id_for", lambda source_id: "client-abc")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = client.get("/api/open-banking/connect/hapoalim", follow_redirects=False)
    assert response.status_code != 302
    assert response.status_code == 503
    assert response.json() == {"code": "cloud_not_configured"}


def test_connect_requires_open_banking_consent(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: True)
    monkeypatch.setattr(routes_module, "licence_id", lambda: None)
    monkeypatch.setattr(routes_module, "client_id_for", lambda source_id: "client-abc")
    authenticate(monkeypatch)
    monkeypatch.setattr(
        routes_module, "ConsentRepository",
        lambda client, user_id, purpose="cloud_sync": type("C", (), {"read": lambda self, version: None})(),
    )
    response = client.get(
        "/api/open-banking/connect/hapoalim", follow_redirects=False,
        headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code != 302
    assert response.status_code == 403
    assert response.json() == {"code": "open_banking_consent_required"}


def test_connections_requires_authentication(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = client.get("/api/open-banking/connections")
    assert response.status_code == 503
    assert response.json() == {"code": "cloud_not_configured"}


def test_connections_list_never_carries_a_token_field(monkeypatch) -> None:
    authenticate(monkeypatch)
    monkeypatch.setattr(
        routes_module, "OpenBankingRepository",
        lambda client, user_id, env=None: type("R", (), {
            "list_connections": lambda self: [OpenBankingConnection(id="conn-1", source_id="hapoalim", status="active", created_at="2026-10-07T00:00:00Z")],
        })(),
    )
    response = client.get(
        "/api/open-banking/connections", headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 200
    body_text = response.text
    assert "refresh" not in body_text.lower() and "token" not in body_text.lower()
    assert response.json() == {"connections": [{"id": "conn-1", "sourceId": "hapoalim", "status": "active", "createdAt": "2026-10-07T00:00:00Z"}]}


def test_connections_list_authenticates_with_the_session_cookie_alone(monkeypatch) -> None:
    """The browser has no token to put in a header — the httpOnly cookie must be enough."""
    tokens_seen: list[str] = []

    def recording_client(_config, token):
        tokens_seen.append(token)
        return FakeAuthenticatedClient()

    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(http_auth_module, "SupabaseRestClient", recording_client)
    monkeypatch.setattr(
        routes_module, "OpenBankingRepository",
        lambda client, user_id, env=None: type("R", (), {
            "list_connections": lambda self: [OpenBankingConnection(id="conn-1", source_id="hapoalim", status="active", created_at="2026-10-07T00:00:00Z")],
        })(),
    )
    cookie_client = TestClient(app)
    cookie_client.cookies.set("he_session", "cookie.session.token")
    response = cookie_client.get("/api/open-banking/connections")

    assert response.request.headers.get("authorization") is None
    assert response.status_code == 200
    assert response.json() == {"connections": [{"id": "conn-1", "sourceId": "hapoalim", "status": "active", "createdAt": "2026-10-07T00:00:00Z"}]}
    assert tokens_seen == ["cookie.session.token"]


def test_connections_list_survives_a_real_select_star_row(monkeypatch) -> None:
    # The real repository, not a fake: a `select=*` row carries `user_id` and
    # `consent_expires_at` too, which once crashed `OpenBankingConnection(**row)` into a 500.
    class RowReturningClient(FakeAuthenticatedClient):
        def table_request(self, method, table, **kwargs):
            return [{
                "id": "conn-1", "user_id": "user-1", "source_id": "hapoalim", "status": "active",
                "consent_expires_at": None, "created_at": "2026-10-07T00:00:00Z",
            }]

    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(http_auth_module, "SupabaseRestClient", lambda _config, _token: RowReturningClient())
    response = client.get(
        "/api/open-banking/connections", headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 200
    assert response.json() == {"connections": [{"id": "conn-1", "sourceId": "hapoalim", "status": "active", "createdAt": "2026-10-07T00:00:00Z"}]}
    assert "user-1" not in response.text


def test_sync_requires_open_banking_consent(monkeypatch) -> None:
    authenticate(monkeypatch)
    monkeypatch.setattr(
        routes_module, "ConsentRepository",
        lambda client, user_id, purpose="cloud_sync": type("C", (), {"read": lambda self, version: None})(),
    )
    response = client.post(
        "/api/open-banking/sync/conn-1", headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 403
    assert response.json() == {"code": "open_banking_consent_required"}


def test_sync_pulls_refreshes_and_returns_mapped_transactions(monkeypatch) -> None:
    authenticate(monkeypatch)
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: True)
    monkeypatch.setattr(routes_module, "licence_id", lambda: None)
    monkeypatch.setattr(
        routes_module, "ConsentRepository",
        lambda client, user_id, purpose="cloud_sync": type("C", (), {
            "read": lambda self, version: type("A", (), {"withdrawn_at": None})(),
        })(),
    )

    class FakeRepository:
        def list_connections(self):
            return [OpenBankingConnection(id="conn-1", source_id="hapoalim", status="active", created_at="2026-10-07T00:00:00Z")]

        def read_refresh_token(self, connection_id: str) -> str:
            return "stored-refresh-token"

        def replace_refresh_token(self, connection_id: str, refresh_token: str) -> None:
            pass

    monkeypatch.setattr(routes_module, "OpenBankingRepository", lambda client, user_id, env=None: FakeRepository())
    monkeypatch.setattr(routes_module, "client_id_for", lambda source_id: "client-abc")
    monkeypatch.setattr(routes_module, "refresh_tokens", lambda source, client_id, refresh_token: TokenPair(access_token="access-1", refresh_token="refresh-2", expires_in=3600))

    from server.models import Transaction
    mapped = Transaction.model_validate({
        "date": "2026-10-04", "vdate": "2026-10-04", "ref": "", "desc": "Groceries",
        "out": 42.0, "in": 0.0, "bal": None, "pending": False, "source": "bank",
        "src": "open-banking", "id": "txn-1",
    })
    monkeypatch.setattr(routes_module, "pull_transactions", lambda source, access_token: [mapped])

    response = client.post(
        "/api/open-banking/sync/conn-1", headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["transactions"][0]["id"] == "txn-1"
    assert "refresh" not in response.text.lower()


def test_sync_refuses_a_non_sandbox_connection_without_a_licence_even_with_consent(monkeypatch) -> None:
    # Finding 2: the sandbox/licence gate must be re-checked on every sync call, not just
    # at connect time — a connection created while sandboxed/licensed must stop syncing the
    # moment that configuration is withdrawn.
    authenticate(monkeypatch)
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: False)
    monkeypatch.setattr(routes_module, "licence_id", lambda: None)
    monkeypatch.setattr(
        routes_module, "ConsentRepository",
        lambda client, user_id, purpose="cloud_sync": type("C", (), {
            "read": lambda self, version: type("A", (), {"withdrawn_at": None})(),
        })(),
    )

    class FakeRepository:
        def list_connections(self):
            return [OpenBankingConnection(id="conn-1", source_id="hapoalim", status="active", created_at="2026-10-07T00:00:00Z")]

    monkeypatch.setattr(routes_module, "OpenBankingRepository", lambda client, user_id, env=None: FakeRepository())
    monkeypatch.setattr(routes_module, "client_id_for", lambda source_id: "client-abc")

    def _unexpected_refresh(*args, **kwargs):
        raise AssertionError("refresh_tokens should not be reached once the sandbox/licence gate refuses the call")

    monkeypatch.setattr(routes_module, "refresh_tokens", _unexpected_refresh)

    response = client.post(
        "/api/open-banking/sync/conn-1", headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 503
    assert response.json() == {"code": "open_banking_not_configured"}


def _sync_against_a_bank_token_endpoint(monkeypatch, fake_post):
    """Runs sync with the *real* refresh_tokens, faking only the bank's HTTP answer, and
    reports what the route did to the connection."""
    authenticate(monkeypatch)
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: True)
    monkeypatch.setattr(routes_module, "licence_id", lambda: None)
    grant_open_banking_consent(monkeypatch)

    effects: dict[str, object] = {"status": "active"}

    class FakeRepository:
        def list_connections(self):
            return [OpenBankingConnection(id="conn-1", source_id="hapoalim", status=effects["status"], created_at="2026-10-07T00:00:00Z")]

        def read_refresh_token(self, connection_id: str) -> str:
            return "stored-refresh-token"

        def replace_refresh_token(self, connection_id: str, refresh_token: str) -> None:
            effects["replaced"] = refresh_token

        def revoke(self, connection_id: str) -> None:
            effects["revoked"] = connection_id
            effects["status"] = "revoked"

    monkeypatch.setattr(routes_module, "OpenBankingRepository", lambda client, user_id, env=None: FakeRepository())
    monkeypatch.setattr(routes_module, "client_id_for", lambda source_id: "client-abc")
    monkeypatch.setattr(routes_module, "pull_transactions", lambda source, access_token: [])
    monkeypatch.setattr(httpx, "post", fake_post)

    response = client.post(
        "/api/open-banking/sync/conn-1", headers={"Authorization": "Bearer user.jwt.token"},
    )
    return response, effects


@pytest.mark.parametrize("status, body", [(400, {"error": "invalid_grant"}), (401, {"error": "invalid_client"})])
def test_sync_revokes_the_connection_when_the_bank_definitively_refuses_the_refresh(monkeypatch, status, body) -> None:
    # A 400/401 refusal looks exactly like "consent expired or withdrawn" from this app's
    # side, so the connection must be revoked immediately, not just reported as a failed sync.
    response, effects = _sync_against_a_bank_token_endpoint(
        monkeypatch, lambda *a, **k: httpx.Response(status, json=body),
    )
    assert response.status_code == 502
    assert response.json() == {"code": "open_banking_refresh_failed"}
    assert effects["revoked"] == "conn-1"
    assert effects["status"] == "revoked"


def _raise(error: Exception):
    def raiser(*a, **k):
        raise error
    return raiser


@pytest.mark.parametrize("fake_post", [
    _raise(httpx.ConnectError("boom")),
    _raise(httpx.ReadTimeout("slow")),
    lambda *a, **k: httpx.Response(500, json={"error": "server_error"}),
    lambda *a, **k: httpx.Response(503, text="Service Unavailable"),
    lambda *a, **k: httpx.Response(200, text="<!DOCTYPE html><html>Internal error</html>"),
    lambda *a, **k: httpx.Response(200, json={"unexpected": "shape"}),
], ids=["network-error", "timeout", "500", "503", "non-json-200", "malformed-json-200"])
def test_sync_leaves_the_connection_active_on_a_transient_refresh_failure(monkeypatch, fake_post) -> None:
    # The spec: "a transient failure is not a revocation" — the user must not have to
    # re-consent at the bank after a network blip.
    response, effects = _sync_against_a_bank_token_endpoint(monkeypatch, fake_post)
    assert response.status_code == 502
    assert response.json() == {"code": "open_banking_refresh_failed"}
    assert "revoked" not in effects
    assert "replaced" not in effects
    assert effects["status"] == "active"


def test_sync_rotates_the_stored_token_on_a_successful_refresh(monkeypatch) -> None:
    response, effects = _sync_against_a_bank_token_endpoint(
        monkeypatch,
        lambda *a, **k: httpx.Response(200, json={"access_token": "a2", "refresh_token": "r2", "expires_in": 1800}),
    )
    assert response.status_code == 200
    assert effects["replaced"] == "r2"
    assert "revoked" not in effects


def test_revoke_calls_the_repository_and_returns_no_content(monkeypatch) -> None:
    authenticate(monkeypatch)
    revoked = {}
    monkeypatch.setattr(
        routes_module, "OpenBankingRepository",
        lambda client, user_id, env=None: type("R", (), {"revoke": lambda self, connection_id: revoked.setdefault("id", connection_id)})(),
    )
    response = client.delete(
        "/api/open-banking/connections/conn-1", headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 204
    assert revoked == {"id": "conn-1"}


# --- GET /api/open-banking/callback -------------------------------------------------
# These pin the route's *current* behaviour. The connect/callback auth flow (a bearer
# header a real browser redirect cannot carry, and the code exchange happening before
# the auth check) is a known limitation awaiting a separate redesign; nothing here
# asserts that ordering as desirable.

CALLBACK_COOKIES = {
    routes_module.SOURCE_COOKIE: "hapoalim",
    routes_module.VERIFIER_COOKIE: "verifier-value",
    routes_module.STATE_COOKIE: "state-value",
}
CALLBACK_URL = "/api/open-banking/callback?code=auth-code&state=state-value"
PAIR = TokenPair(access_token="access-1", refresh_token="refresh-1", expires_in=3600)


def callback_client() -> TestClient:
    # A client of its own, so the PKCE cookies never leak into the module-wide one.
    return TestClient(app, cookies=CALLBACK_COOKIES)


def configure_callback(monkeypatch, *, sandbox: bool = True, licence: str | None = None, exchanged=PAIR) -> dict:
    calls: dict = {}
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: sandbox)
    monkeypatch.setattr(routes_module, "licence_id", lambda: licence)
    monkeypatch.setattr(routes_module, "client_id_for", lambda source_id: "client-abc")

    def fake_exchange(source, client_id, code, verifier, redirect_uri):
        calls["exchange"] = {"source": source.id, "client_id": client_id, "code": code, "verifier": verifier}
        return exchanged

    monkeypatch.setattr(routes_module, "exchange_code", fake_exchange)

    class FakeRepository:
        def create_connection(self, source_id: str, refresh_token: str):
            calls["created"] = {"source_id": source_id, "refresh_token": refresh_token}
            return OpenBankingConnection(id="conn-1", source_id=source_id, status="active", created_at="2026-10-07T00:00:00Z")

    monkeypatch.setattr(routes_module, "OpenBankingRepository", lambda client, user_id, env=None: FakeRepository())
    return calls


def test_callback_state_mismatch_redirects_instead_of_returning_raw_json() -> None:
    response = callback_client().get(
        "/api/open-banking/callback?code=abc&state=wrong", follow_redirects=False,
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/mazan-habait.html?openBankingError=open_banking_state_mismatch"


def test_callback_clears_all_pkce_cookies_even_on_a_state_mismatch() -> None:
    response = callback_client().get(
        "/api/open-banking/callback?code=abc&state=wrong", follow_redirects=False,
    )
    set_cookie_headers = response.headers.get_list("set-cookie")
    for name in ("he_ob_state", "he_ob_pkce", "he_ob_source"):
        assert any(header.startswith(f"{name}=") and "Max-Age=0" in header for header in set_cookie_headers)


def test_callback_refuses_a_non_sandbox_exchange_without_a_licence(monkeypatch) -> None:
    calls = configure_callback(monkeypatch, sandbox=False, licence=None)
    authenticate(monkeypatch)

    def _unexpected_exchange(*args, **kwargs):
        raise AssertionError("exchange_code must not be reached once the sandbox/licence gate refuses the call")

    monkeypatch.setattr(routes_module, "exchange_code", _unexpected_exchange)

    response = callback_client().get(
        CALLBACK_URL, follow_redirects=False, headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/mazan-habait.html?openBankingError=open_banking_not_configured"
    assert "created" not in calls


def test_callback_proceeds_past_the_gate_with_a_licence_even_when_not_sandboxed(monkeypatch) -> None:
    calls = configure_callback(monkeypatch, sandbox=False, licence="licence-123")
    authenticate(monkeypatch)
    response = callback_client().get(
        CALLBACK_URL, follow_redirects=False, headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 302
    assert "exchange" in calls


def test_callback_rejects_a_state_that_does_not_match_the_cookie(monkeypatch) -> None:
    calls = configure_callback(monkeypatch)
    authenticate(monkeypatch)
    response = callback_client().get(
        "/api/open-banking/callback?code=auth-code&state=forged-state", follow_redirects=False,
        headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/mazan-habait.html?openBankingError=open_banking_state_mismatch"
    assert "exchange" not in calls


def test_callback_rejects_a_request_without_the_pkce_cookies(monkeypatch) -> None:
    calls = configure_callback(monkeypatch)
    authenticate(monkeypatch)
    response = TestClient(app).get(
        CALLBACK_URL, follow_redirects=False, headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/mazan-habait.html?openBankingError=open_banking_state_mismatch"
    assert "exchange" not in calls


def test_callback_reports_a_failed_exchange_without_creating_a_connection(monkeypatch) -> None:
    calls = configure_callback(monkeypatch, exchanged=None)
    authenticate(monkeypatch)
    response = callback_client().get(
        CALLBACK_URL, follow_redirects=False, headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/mazan-habait.html?openBankingError=open_banking_exchange_failed"
    assert "created" not in calls


def test_callback_requires_cloud_configuration_like_the_other_authenticated_routes(monkeypatch) -> None:
    calls = configure_callback(monkeypatch)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = callback_client().get(CALLBACK_URL, follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/mazan-habait.html?openBankingError=cloud_not_configured"
    assert "created" not in calls


def test_callback_requires_a_bearer_token_like_the_other_authenticated_routes(monkeypatch) -> None:
    calls = configure_callback(monkeypatch)
    authenticate(monkeypatch)
    response = callback_client().get(CALLBACK_URL, follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/mazan-habait.html?openBankingError=authentication_required"
    assert "created" not in calls


def test_callback_rejects_an_invalid_session_like_the_other_authenticated_routes(monkeypatch) -> None:
    calls = configure_callback(monkeypatch)
    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(
        http_auth_module, "SupabaseRestClient",
        lambda _config, _token: type("Unverified", (), {"verify_user": lambda self: None})(),
    )
    response = callback_client().get(
        CALLBACK_URL, follow_redirects=False, headers={"Authorization": "Bearer expired.jwt.token"},
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/mazan-habait.html?openBankingError=invalid_session"
    assert "created" not in calls


def test_callback_stores_the_connection_and_returns_to_the_app(monkeypatch) -> None:
    calls = configure_callback(monkeypatch)
    authenticate(monkeypatch)
    response = callback_client().get(
        CALLBACK_URL, follow_redirects=False, headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/mazan-habait.html"
    assert calls["exchange"] == {"source": "hapoalim", "client_id": "client-abc", "code": "auth-code", "verifier": "verifier-value"}
    assert calls["created"] == {"source_id": "hapoalim", "refresh_token": "refresh-1"}
    cleared = response.headers.get_list("set-cookie")
    for cookie in (routes_module.VERIFIER_COOKIE, routes_module.STATE_COOKIE, routes_module.SOURCE_COOKIE):
        assert any(header.startswith(f"{cookie}=") and "Max-Age=0" in header for header in cleared)
    assert "refresh-1" not in response.text


def test_callback_reports_a_failed_connection_write(monkeypatch) -> None:
    configure_callback(monkeypatch)
    authenticate(monkeypatch)
    from server.supabase_store import SupabaseDataError

    def _failing_create(source_id, refresh_token):
        raise SupabaseDataError("open_banking_connection_write")

    monkeypatch.setattr(
        routes_module, "OpenBankingRepository",
        lambda client, user_id, env=None: type("R", (), {"create_connection": lambda self, s, r: _failing_create(s, r)})(),
    )
    response = callback_client().get(
        CALLBACK_URL, follow_redirects=False, headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 302
    assert response.headers["location"] == "/mazan-habait.html?openBankingError=open_banking_connection_failed"


def test_accept_consent_requires_authentication(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = client.put("/api/consents/open-banking", json={"locale": "he"})
    assert response.status_code == 503
    assert response.json() == {"code": "cloud_not_configured"}


def test_accept_consent_records_the_statement_version_and_locale(monkeypatch) -> None:
    from datetime import datetime, timezone

    authenticate(monkeypatch)
    recorded = {}

    class FakeAcceptance:
        purpose = "open_banking"
        statement_version = routes_module.OPEN_BANKING_CONSENT_VERSION
        locale = "he"
        accepted_at = datetime(2026, 10, 8, 12, 0, 0, tzinfo=timezone.utc)
        withdrawn_at = None

    def fake_accept(self, statement_version, locale):
        recorded["statement_version"] = statement_version
        recorded["locale"] = locale
        return FakeAcceptance()

    monkeypatch.setattr(
        routes_module, "ConsentRepository",
        lambda client, user_id, purpose="cloud_sync": type("C", (), {"accept": fake_accept})(),
    )
    response = client.put(
        "/api/consents/open-banking", json={"locale": "he"}, headers={"Authorization": "Bearer user.jwt.token"},
    )
    assert response.status_code == 200
    assert response.json() == {"consent": {
        "purpose": "open_banking", "statementVersion": routes_module.OPEN_BANKING_CONSENT_VERSION,
        "locale": "he", "acceptedAt": "2026-10-08T12:00:00+00:00", "withdrawnAt": None,
    }}
    assert recorded == {"statement_version": routes_module.OPEN_BANKING_CONSENT_VERSION, "locale": "he"}


def test_read_consent_requires_authentication(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = client.get("/api/consents/open-banking")
    assert response.status_code == 503
    assert response.json() == {"code": "cloud_not_configured"}


def test_read_consent_reports_none_when_never_accepted(monkeypatch) -> None:
    authenticate(monkeypatch)
    monkeypatch.setattr(
        routes_module, "ConsentRepository",
        lambda client, user_id, purpose="cloud_sync": type("C", (), {"read": lambda self, version: None})(),
    )
    response = client.get("/api/consents/open-banking", headers={"Authorization": "Bearer user.jwt.token"})
    assert response.status_code == 200
    assert response.json() == {"consent": None}


def test_read_consent_returns_the_current_acceptance(monkeypatch) -> None:
    from datetime import datetime, timezone

    authenticate(monkeypatch)

    class FakeAcceptance:
        purpose = "open_banking"
        statement_version = routes_module.OPEN_BANKING_CONSENT_VERSION
        locale = "en"
        accepted_at = datetime(2026, 10, 8, 12, 0, 0, tzinfo=timezone.utc)
        withdrawn_at = None

    monkeypatch.setattr(
        routes_module, "ConsentRepository",
        lambda client, user_id, purpose="cloud_sync": type("C", (), {"read": lambda self, version: FakeAcceptance()})(),
    )
    response = client.get("/api/consents/open-banking", headers={"Authorization": "Bearer user.jwt.token"})
    assert response.status_code == 200
    assert response.json() == {"consent": {
        "purpose": "open_banking", "statementVersion": routes_module.OPEN_BANKING_CONSENT_VERSION,
        "locale": "en", "acceptedAt": "2026-10-08T12:00:00+00:00", "withdrawnAt": None,
    }}


def test_withdraw_consent_requires_authentication(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = client.delete("/api/consents/open-banking")
    assert response.status_code == 503
    assert response.json() == {"code": "cloud_not_configured"}


def test_withdraw_consent_is_a_no_op_when_nothing_was_accepted(monkeypatch) -> None:
    authenticate(monkeypatch)
    calls = {"withdraw": False}
    monkeypatch.setattr(
        routes_module, "ConsentRepository",
        lambda client, user_id, purpose="cloud_sync": type("C", (), {
            "read": lambda self, version: None,
            "withdraw": lambda self, version: calls.__setitem__("withdraw", True),
        })(),
    )
    response = client.delete("/api/consents/open-banking", headers={"Authorization": "Bearer user.jwt.token"})
    assert response.status_code == 204
    assert calls["withdraw"] is False


def test_withdraw_consent_withdraws_an_existing_acceptance(monkeypatch) -> None:
    authenticate(monkeypatch)
    calls = {"withdraw": False}
    monkeypatch.setattr(
        routes_module, "ConsentRepository",
        lambda client, user_id, purpose="cloud_sync": type("C", (), {
            "read": lambda self, version: type("A", (), {"withdrawn_at": None})(),
            "withdraw": lambda self, version: calls.__setitem__("withdraw", True),
        })(),
    )
    response = client.delete("/api/consents/open-banking", headers={"Authorization": "Bearer user.jwt.token"})
    assert response.status_code == 204
    assert calls["withdraw"] is True
