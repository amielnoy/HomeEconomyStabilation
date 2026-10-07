import httpx
import pytest
from fastapi.testclient import TestClient

import server.app as app_module
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
    monkeypatch.setattr(app_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(app_module, "SupabaseRestClient", lambda _config, _token: FakeAuthenticatedClient())


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


def test_connections_list_survives_a_real_select_star_row(monkeypatch) -> None:
    # The real repository, not a fake: a `select=*` row carries `user_id` and
    # `consent_expires_at` too, which once crashed `OpenBankingConnection(**row)` into a 500.
    class RowReturningClient(FakeAuthenticatedClient):
        def table_request(self, method, table, **kwargs):
            return [{
                "id": "conn-1", "user_id": "user-1", "source_id": "hapoalim", "status": "active",
                "consent_expires_at": None, "created_at": "2026-10-07T00:00:00Z",
            }]

    monkeypatch.setattr(app_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(app_module, "SupabaseRestClient", lambda _config, _token: RowReturningClient())
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
