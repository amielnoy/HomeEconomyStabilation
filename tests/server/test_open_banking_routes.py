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


def test_connect_redirects_to_the_sources_authorize_url_in_sandbox_mode(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: True)
    monkeypatch.setattr(routes_module, "licence_id", lambda: None)
    monkeypatch.setattr(routes_module, "client_id_for", lambda source_id: "client-abc")
    response = client.get("/api/open-banking/connect/hapoalim", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"].startswith(SOURCE.authorization_url)


def test_connect_with_an_unknown_source_id_is_not_found(monkeypatch) -> None:
    monkeypatch.setattr(routes_module, "read_sources", lambda: [SOURCE])
    monkeypatch.setattr(routes_module, "sandbox_enabled", lambda: True)
    response = client.get("/api/open-banking/connect/unknown", follow_redirects=False)
    assert response.status_code == 404


class FakeAuthenticatedClient:
    def verify_user(self) -> str:
        return "user-1"


def authenticate(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(app_module, "SupabaseRestClient", lambda _config, _token: FakeAuthenticatedClient())


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
