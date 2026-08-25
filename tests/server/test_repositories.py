from collections import deque
from typing import Any

import pytest

from server.models import CloudStatePayload
from server.supabase_store import (
    ConsentRepository,
    SnapshotRepository,
    SupabaseDataError,
    UserProfileRepository,
)


class FakeRestClient:
    def __init__(self, responses: list[list[dict[str, Any]] | Exception]) -> None:
        self.responses = deque(responses)
        self.calls: list[dict[str, Any]] = []

    def table_request(self, method: str, table: str, **kwargs: Any) -> list[dict[str, Any]]:
        self.calls.append({"method": method, "table": table, **kwargs})
        response = self.responses.popleft()
        if isinstance(response, Exception):
            raise response
        return response


def payload() -> CloudStatePayload:
    return CloudStatePayload.model_validate({"tx": [], "overrides": {}, "rules": [], "cats": [], "budgets": {}})


def test_snapshot_repository_reads_writes_and_deletes_only_the_owner_row() -> None:
    row = {"payload": payload().persistence_dict(), "schema_version": 2, "updated_at": "2026-08-24T20:00:00Z"}
    client = FakeRestClient([[row], [row], []])
    repository = SnapshotRepository(client, "user-1")  # type: ignore[arg-type]

    assert repository.read().schemaVersion == 2  # type: ignore[union-attr]
    assert repository.save(payload()).schemaVersion == 2
    repository.delete()

    # The write is a single upsert, so it carries the owner in the body rather than
    # in a filter; reads and deletes still scope by user_id.
    assert all(
        call.get("params", {}).get("user_id") == "eq.user-1"
        for call in client.calls if call["method"] in {"GET", "DELETE"}
    )
    assert [call["method"] for call in client.calls] == ["GET", "POST", "DELETE"]
    write = client.calls[1]
    assert write["json"]["user_id"] == "user-1"
    assert "resolution=merge-duplicates" in write["prefer"]


def test_profile_repository_creates_a_minimal_profile() -> None:
    row = {
        "user_id": "user-1", "preferred_locale": "fr",
        "created_at": "2026-08-24T20:00:00Z", "updated_at": "2026-08-24T20:00:00Z",
    }
    client = FakeRestClient([[row]])
    profile = UserProfileRepository(client, "user-1").save("fr")  # type: ignore[arg-type]
    assert profile.preferred_locale == "fr"
    assert len(client.calls) == 1, "saving a profile should take one round trip, not two"
    assert client.calls[-1]["json"] == {"user_id": "user-1", "preferred_locale": "fr"}
    assert "resolution=merge-duplicates" in client.calls[-1]["prefer"]


def test_consent_repository_accepts_reads_and_withdraws_a_version() -> None:
    consent = {
        "user_id": "user-1", "purpose": "cloud_sync", "statement_version": "v2", "locale": "he",
        "accepted_at": "2026-08-24T20:00:00Z", "withdrawn_at": None,
    }
    withdrawn = {**consent, "withdrawn_at": "2026-08-24T21:00:00Z"}
    client = FakeRestClient([[consent], [consent], [withdrawn]])
    repository = ConsentRepository(client, "user-1")  # type: ignore[arg-type]
    assert repository.accept("v2", "he").withdrawn_at is None
    assert repository.read("v2") is not None
    assert repository.withdraw("v2").withdrawn_at is not None
    assert [call["method"] for call in client.calls] == ["POST", "GET", "PATCH"]
    assert "resolution=merge-duplicates" in client.calls[0]["prefer"]


def test_repository_error_does_not_include_provider_details() -> None:
    client = FakeRestClient([SupabaseDataError("snapshot_read")])
    with pytest.raises(SupabaseDataError, match="snapshot_read") as raised:
        SnapshotRepository(client, "user-1").read()  # type: ignore[arg-type]
    assert "provider" not in str(raised.value)
