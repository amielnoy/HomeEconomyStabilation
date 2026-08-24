from fastapi.testclient import TestClient

from server.app import app


client = TestClient(app)


def test_health_supports_get_head_and_stable_method_refusal() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "home-economy-api"}
    assert response.headers["cache-control"] == "no-store"
    assert client.head("/api/health").status_code == 200
    refusal = client.post("/api/health")
    assert refusal.status_code == 405
    assert refusal.json() == {"code": "method_not_allowed"}


def test_snapshot_boundary_rejects_media_and_invalid_payload_before_configuration() -> None:
    wrong_media = client.put("/api/snapshots", content="not-json", headers={"content-type": "text/plain"})
    assert wrong_media.status_code == 415
    assert wrong_media.json() == {"code": "json_content_type_required"}

    invalid = client.put("/api/snapshots", json={"schemaVersion": 2, "payload": {"tx": "wrong"}})
    assert invalid.status_code == 400
    assert invalid.json() == {"code": "invalid_snapshot"}


def test_snapshot_boundary_fails_closed_without_server_configuration(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = client.get("/api/snapshots")
    assert response.status_code == 503
    assert response.json() == {"code": "cloud_not_configured"}
