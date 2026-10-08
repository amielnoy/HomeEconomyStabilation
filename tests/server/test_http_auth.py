from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

import server.http_auth as http_auth_module
from server.http_auth import SESSION_COOKIE, authenticated_client

app = FastAPI()


@app.get("/probe")
async def probe(request: Request):
    result = await authenticated_client(request)
    if isinstance(result, JSONResponse):
        return result
    _client, user_id = result
    return {"userId": user_id}


client = TestClient(app)


class FakeAuthenticatedClient:
    def verify_user(self) -> str:
        return "user-1"


def test_refuses_when_supabase_is_not_configured(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = client.get("/probe")
    assert response.status_code == 503
    assert response.json() == {"code": "cloud_not_configured"}


def test_refuses_when_neither_header_nor_cookie_is_present(monkeypatch) -> None:
    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    response = client.get("/probe")
    assert response.status_code == 401
    assert response.json() == {"code": "authentication_required"}


def test_accepts_the_bearer_header(monkeypatch) -> None:
    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(http_auth_module, "SupabaseRestClient", lambda _config, _token: FakeAuthenticatedClient())
    response = client.get("/probe", headers={"Authorization": "Bearer header.token.value"})
    assert response.status_code == 200
    assert response.json() == {"userId": "user-1"}


def test_accepts_the_session_cookie_when_there_is_no_header(monkeypatch) -> None:
    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(http_auth_module, "SupabaseRestClient", lambda _config, _token: FakeAuthenticatedClient())
    response = client.get("/probe", cookies={SESSION_COOKIE: "cookie.token.value"})
    assert response.status_code == 200
    assert response.json() == {"userId": "user-1"}


def test_the_header_wins_when_both_are_present(monkeypatch) -> None:
    captured = {}

    def fake_client(_config, token):
        captured["token"] = token
        return FakeAuthenticatedClient()

    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(http_auth_module, "SupabaseRestClient", fake_client)
    response = client.get(
        "/probe",
        headers={"Authorization": "Bearer header.token.value"},
        cookies={SESSION_COOKIE: "cookie.token.value"},
    )
    assert response.status_code == 200
    assert captured["token"] == "header.token.value"


def test_rejects_an_unverifiable_session(monkeypatch) -> None:
    monkeypatch.setattr(http_auth_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(
        http_auth_module, "SupabaseRestClient",
        lambda _config, _token: type("Unverified", (), {"verify_user": lambda self: None})(),
    )
    response = client.get("/probe", cookies={SESSION_COOKIE: "cookie.token.value"})
    assert response.status_code == 401
    assert response.json() == {"code": "invalid_session"}
