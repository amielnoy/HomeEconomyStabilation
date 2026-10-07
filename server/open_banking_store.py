from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from .open_banking_crypto import decrypt_token, encrypt_token
from .supabase_store import SupabaseDataError


@dataclass(frozen=True, slots=True)
class OpenBankingConnection:
    id: str
    source_id: str
    status: Literal["active", "revoked"]
    created_at: str


class OpenBankingRepository:
    def __init__(self, client: Any, user_id: str, env: dict[str, str] | None = None) -> None:
        self._client, self._user_id, self._env = client, user_id, env

    def list_connections(self) -> list[OpenBankingConnection]:
        rows = self._client.table_request(
            "GET", "open_banking_connections", operation="open_banking_connections_read",
            params={"user_id": f"eq.{self._user_id}", "select": "*"},
        )
        return [OpenBankingConnection(**row) for row in rows]

    def create_connection(self, source_id: str, refresh_token: str) -> OpenBankingConnection:
        rows = self._client.table_request(
            "POST", "open_banking_connections", operation="open_banking_connection_write",
            params={"select": "*"},
            json={"user_id": self._user_id, "source_id": source_id, "status": "active"},
            prefer="return=representation",
        )
        if not rows:
            raise SupabaseDataError("open_banking_connection_write")
        connection = OpenBankingConnection(**rows[0])
        self.replace_refresh_token(connection.id, refresh_token)
        return connection

    def replace_refresh_token(self, connection_id: str, refresh_token: str) -> None:
        encrypted = encrypt_token(refresh_token, self._env)
        if not encrypted:
            raise SupabaseDataError("open_banking_token_encrypt")
        self._client.table_request(
            "POST", "open_banking_tokens", operation="open_banking_token_write",
            params={"select": "connection_id"},
            json={"connection_id": connection_id, "encrypted_refresh_token": encrypted},
            prefer="return=representation,resolution=merge-duplicates",
        )

    def read_refresh_token(self, connection_id: str) -> str | None:
        rows = self._client.table_request(
            "GET", "open_banking_tokens", operation="open_banking_token_read",
            params={"connection_id": f"eq.{connection_id}", "select": "encrypted_refresh_token", "limit": "1"},
        )
        if not rows:
            return None
        return decrypt_token(rows[0]["encrypted_refresh_token"], self._env)

    def revoke(self, connection_id: str) -> None:
        # The token is deleted first: a connection left briefly in a state that still
        # carries a token but is not yet marked revoked is still only readable by its
        # owner, but a token that no longer works is not worth the risk of holding.
        self._client.table_request(
            "DELETE", "open_banking_tokens", operation="open_banking_token_delete",
            params={"connection_id": f"eq.{connection_id}"}, prefer="return=minimal",
        )
        self._client.table_request(
            "PATCH", "open_banking_connections", operation="open_banking_connection_write",
            params={"id": f"eq.{connection_id}", "user_id": f"eq.{self._user_id}", "select": "*"},
            json={"status": "revoked"}, prefer="return=representation",
        )
