from collections import deque
from typing import Any

from cryptography.fernet import Fernet

from server.open_banking_store import OpenBankingRepository

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
