from fastapi.testclient import TestClient

from datetime import datetime, timezone

import server.app as app_module
from server.app import CLOUD_CONSENT_VERSION, app
from server.models import ConsentAcceptance, UserProfile
from server.supabase_store import StoredSnapshot


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


def test_snapshot_boundary_rejects_media_before_doing_any_work() -> None:
    wrong_media = client.put("/api/snapshots", content="not-json", headers={"content-type": "text/plain"})
    assert wrong_media.status_code == 415
    assert wrong_media.json() == {"code": "json_content_type_required"}


def test_snapshot_payload_is_not_parsed_for_an_unauthenticated_caller(monkeypatch) -> None:
    """Validating a megabyte of JSON is work; a stranger should not be able to demand it."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    invalid = client.put("/api/snapshots", json={"schemaVersion": 2, "payload": {"tx": "wrong"}})
    assert invalid.status_code == 503
    assert invalid.json() == {"code": "cloud_not_configured"}


def test_snapshot_boundary_fails_closed_without_server_configuration(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    response = client.get("/api/snapshots")
    assert response.status_code == 503
    assert response.json() == {"code": "cloud_not_configured"}


class FakeAuthenticatedClient:
    def verify_user(self) -> str:
        return "user-1"


def authenticate(monkeypatch) -> None:
    monkeypatch.setattr(app_module, "read_supabase_config", lambda: object())
    monkeypatch.setattr(app_module, "SupabaseRestClient", lambda _config, _token: FakeAuthenticatedClient())


def test_profile_and_consent_validate_small_bodies_before_provider_work(monkeypatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_PUBLISHABLE_KEY", raising=False)
    assert client.put("/api/profile", json={"preferredLocale": "xx"}).json() == {"code": "invalid_request"}
    assert client.put("/api/consents/cloud-sync", json={"locale": "xx"}).json() == {"code": "invalid_request"}
    refusal = client.post("/api/profile")
    assert refusal.status_code == 405
    assert refusal.headers["allow"] == "GET, PUT"


def test_profile_preference_is_read_from_and_written_to_supabase(monkeypatch) -> None:
    authenticate(monkeypatch)
    now = datetime(2026, 8, 25, 10, 0, tzinfo=timezone.utc)
    saved_locales: list[str] = []

    class FakeProfiles:
        def __init__(self, _client, _user_id: str) -> None: pass
        def read(self) -> UserProfile:
            return UserProfile(user_id="user-1", preferred_locale="he", created_at=now, updated_at=now)
        def save(self, locale: str) -> UserProfile:
            saved_locales.append(locale)
            return UserProfile(user_id="user-1", preferred_locale=locale, created_at=now, updated_at=now)  # type: ignore[arg-type]

    monkeypatch.setattr(app_module, "UserProfileRepository", FakeProfiles)
    assert client.get("/api/profile", headers={"authorization": "Bearer token"}).json()["profile"]["preferredLocale"] == "he"
    response = client.put("/api/profile", json={"preferredLocale": "fr"}, headers={"authorization": "Bearer token"})
    assert response.status_code == 200
    assert response.json()["profile"]["preferredLocale"] == "fr"
    assert saved_locales == ["fr"]


def test_cloud_consent_is_persisted_and_required_before_snapshot_write(monkeypatch) -> None:
    authenticate(monkeypatch)
    now = datetime(2026, 8, 25, 10, 0, tzinfo=timezone.utc)
    active: list[ConsentAcceptance] = []
    snapshot_writes: list[object] = []

    class FakeConsents:
        def __init__(self, _client, _user_id: str) -> None: pass
        def read(self, version: str):
            assert version == CLOUD_CONSENT_VERSION
            return active[-1] if active else None
        def accept(self, version: str, locale: str) -> ConsentAcceptance:
            value = ConsentAcceptance(
                user_id="user-1", purpose="cloud_sync", statement_version=version,
                locale=locale, accepted_at=now, withdrawn_at=None,  # type: ignore[arg-type]
            )
            active.append(value)
            return value
        def withdraw(self, version: str) -> ConsentAcceptance:
            assert active and version == CLOUD_CONSENT_VERSION
            value = active[-1].model_copy(update={"withdrawn_at": now})
            active.append(value)
            return value

    class FakeSnapshots:
        def __init__(self, _client, _user_id: str) -> None: pass
        def save(self, payload):
            snapshot_writes.append(payload)
            return StoredSnapshot(2, payload.persistence_dict(), now.isoformat())

    monkeypatch.setattr(app_module, "ConsentRepository", FakeConsents)
    monkeypatch.setattr(app_module, "SnapshotRepository", FakeSnapshots)
    headers = {"authorization": "Bearer token"}
    payload = {"schemaVersion": 2, "payload": {"tx": [], "overrides": {}, "rules": [], "cats": [], "budgets": {}}}
    refused = client.put("/api/snapshots", json=payload, headers=headers)
    assert refused.status_code == 403
    assert refused.json() == {"code": "cloud_consent_required"}
    assert snapshot_writes == []

    accepted = client.put("/api/consents/cloud-sync", json={"locale": "he"}, headers=headers)
    assert accepted.status_code == 200
    assert accepted.json()["consent"]["statementVersion"] == CLOUD_CONSENT_VERSION
    assert client.put("/api/snapshots", json=payload, headers=headers).status_code == 200
    assert len(snapshot_writes) == 1

    withdrawn = client.delete("/api/consents/cloud-sync", headers=headers)
    assert withdrawn.status_code == 204
    refused_after_withdrawal = client.put("/api/snapshots", json=payload, headers=headers)
    assert refused_after_withdrawal.status_code == 403
    assert refused_after_withdrawal.json() == {"code": "cloud_consent_required"}
    assert len(snapshot_writes) == 1
