from collections import deque
from typing import Any

import pytest
from cryptography.fernet import Fernet

from server.open_banking_store import OpenBankingConnection, OpenBankingRepository
from server.supabase_store import SupabaseDataError

ENV = {"OPEN_BANKING_TOKEN_ENCRYPTION_KEY": Fernet.generate_key().decode()}


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


def test_creating_a_connection_stores_the_refresh_token_encrypted_not_plaintext() -> None:
    connection_row = {"id": "conn-1", "source_id": "hapoalim", "status": "active", "created_at": "2026-10-07T00:00:00Z"}
    client = FakeRestClient([[connection_row], [{"connection_id": "conn-1"}]])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]

    connection = repository.create_connection("hapoalim", "sandbox-refresh-token")

    assert connection.id == "conn-1"
    connection_write, token_write = client.calls
    assert connection_write["json"] == {"user_id": "user-1", "source_id": "hapoalim", "status": "active"}
    assert token_write["table"] == "open_banking_tokens"
    assert token_write["json"]["connection_id"] == "conn-1"
    assert "sandbox-refresh-token" not in token_write["json"]["encrypted_refresh_token"]


def test_reading_a_refresh_token_decrypts_it() -> None:
    client = FakeRestClient([])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]
    from server.open_banking_crypto import encrypt_token
    stored = encrypt_token("sandbox-refresh-token", ENV)
    client.responses.append([{"encrypted_refresh_token": stored}])

    assert repository.read_refresh_token("conn-1") == "sandbox-refresh-token"
    assert client.calls[0]["params"]["connection_id"] == "eq.conn-1"


def test_reading_a_missing_token_returns_none_rather_than_raising() -> None:
    client = FakeRestClient([[]])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]
    assert repository.read_refresh_token("conn-1") is None


def test_revoking_deletes_the_token_and_marks_the_connection_revoked() -> None:
    client = FakeRestClient([[], [{"id": "conn-1", "source_id": "hapoalim", "status": "revoked", "created_at": "2026-10-07T00:00:00Z"}]])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]

    repository.revoke("conn-1")

    token_delete, status_update = client.calls
    assert token_delete == {"method": "DELETE", "table": "open_banking_tokens", "operation": "open_banking_token_delete",
                             "params": {"connection_id": "eq.conn-1"}, "prefer": "return=minimal"}
    assert status_update["json"] == {"status": "revoked"}


def test_listing_connections_scopes_to_the_user() -> None:
    row = {"id": "conn-1", "source_id": "hapoalim", "status": "active", "created_at": "2026-10-07T00:00:00Z"}
    client = FakeRestClient([[row]])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]

    connections = repository.list_connections()

    assert connections[0].source_id == "hapoalim"
    assert client.calls[0]["params"]["user_id"] == "eq.user-1"


# A real `select=*` row carries every column the migration defines, not just the four
# the dataclass models — `user_id` and `consent_expires_at` included.
REAL_ROW = {
    "id": "conn-1", "user_id": "user-1", "source_id": "hapoalim", "status": "active",
    "consent_expires_at": None, "created_at": "2026-10-07T00:00:00Z",
}


def test_listing_connections_accepts_a_real_supabase_row_with_extra_columns() -> None:
    client = FakeRestClient([[REAL_ROW]])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]

    connections = repository.list_connections()

    assert connections == [OpenBankingConnection(id="conn-1", source_id="hapoalim", status="active", created_at="2026-10-07T00:00:00Z")]


def test_creating_a_connection_accepts_a_real_supabase_row_and_still_writes_the_token() -> None:
    client = FakeRestClient([[REAL_ROW], [{"connection_id": "conn-1"}]])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]

    connection = repository.create_connection("hapoalim", "sandbox-refresh-token")

    assert connection == OpenBankingConnection(id="conn-1", source_id="hapoalim", status="active", created_at="2026-10-07T00:00:00Z")
    assert [call["table"] for call in client.calls] == ["open_banking_connections", "open_banking_tokens"]


def test_creating_a_connection_raises_when_the_insert_returns_no_row() -> None:
    client = FakeRestClient([[]])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]

    with pytest.raises(SupabaseDataError) as exc_info:
        repository.create_connection("hapoalim", "sandbox-refresh-token")

    assert exc_info.value.operation == "open_banking_connection_write"
    assert len(client.calls) == 1  # no token write is attempted for a connection that does not exist


def test_a_connection_row_missing_a_required_column_is_a_data_error_not_a_crash() -> None:
    client = FakeRestClient([[{"id": "conn-1", "user_id": "user-1", "status": "active"}]])
    repository = OpenBankingRepository(client, "user-1", env=ENV)  # type: ignore[arg-type]

    with pytest.raises(SupabaseDataError) as exc_info:
        repository.list_connections()

    assert exc_info.value.operation == "open_banking_connections_read"


def test_replace_refresh_token_raises_with_missing_encryption_key() -> None:
    client = FakeRestClient([])
    repository = OpenBankingRepository(client, "user-1", env={})  # type: ignore[arg-type]

    with pytest.raises(SupabaseDataError) as exc_info:
        repository.replace_refresh_token("conn-1", "sandbox-refresh-token")

    assert exc_info.value.operation == "open_banking_token_encrypt"
