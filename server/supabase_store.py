from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from time import monotonic
from typing import Any, Literal

import httpx

from .config import SupabaseConfig
from .models import CloudStatePayload, ConsentAcceptance, Locale, UserProfile
from .metrics import record_supabase_response

Operation = Literal[
    "profile_read", "profile_write", "snapshot_read", "snapshot_write", "snapshot_delete",
    "consent_read", "consent_write", "consent_withdraw",
]


class SupabaseDataError(RuntimeError):
    def __init__(self, operation: Operation) -> None:
        super().__init__(f"Supabase operation failed: {operation}")
        self.operation = operation


class SupabaseRestClient:
    def __init__(self, config: SupabaseConfig, access_token: str, timeout_seconds: float = 8.0) -> None:
        self._config = config
        self._headers = {
            "apikey": config.publishable_key,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        self._timeout = timeout_seconds

    def verify_user(self) -> str | None:
        started = monotonic()
        try:
            response = httpx.get(
                f"{self._config.url}/auth/v1/user", headers=self._headers, timeout=self._timeout,
            )
            record_supabase_response("auth_verify", response.status_code, monotonic() - started)
            if response.status_code != 200:
                return None
            user_id = response.json().get("id")
            return user_id if isinstance(user_id, str) and user_id else None
        except (httpx.HTTPError, ValueError):
            record_supabase_response("auth_verify", 0, monotonic() - started)
            return None

    def table_request(
        self,
        method: str,
        table: str,
        *,
        operation: Operation,
        params: dict[str, str] | None = None,
        json: object | None = None,
        prefer: str | None = None,
    ) -> list[dict[str, Any]]:
        headers = dict(self._headers)
        if prefer:
            headers["Prefer"] = prefer
        try:
            started = monotonic()
            response = httpx.request(
                method,
                f"{self._config.url}/rest/v1/{table}",
                headers=headers,
                params=params,
                json=json,
                timeout=self._timeout,
            )
            record_supabase_response(operation, response.status_code, monotonic() - started)
            if response.status_code >= 400:
                raise SupabaseDataError(operation)
            if response.status_code == 204 or not response.content:
                return []
            data = response.json()
            if not isinstance(data, list):
                raise SupabaseDataError(operation)
            return data
        except SupabaseDataError:
            raise
        except (httpx.HTTPError, ValueError) as cause:
            record_supabase_response(operation, 0, monotonic() - started)
            raise SupabaseDataError(operation) from cause


@dataclass(frozen=True, slots=True)
class StoredSnapshot:
    schemaVersion: int
    payload: dict[str, Any]
    updatedAt: str


class UserProfileRepository:
    def __init__(self, client: SupabaseRestClient, user_id: str) -> None:
        self._client, self._user_id = client, user_id

    def read(self) -> UserProfile | None:
        rows = self._client.table_request(
            "GET", "user_profiles", operation="profile_read",
            params={"user_id": f"eq.{self._user_id}", "select": "*", "limit": "1"},
        )
        return UserProfile.model_validate(rows[0]) if rows else None

    def save(self, locale: Locale) -> UserProfile:
        existing = self.read()
        if existing:
            rows = self._client.table_request(
                "PATCH", "user_profiles", operation="profile_write",
                params={"user_id": f"eq.{self._user_id}", "select": "*"},
                json={"preferred_locale": locale}, prefer="return=representation",
            )
        else:
            rows = self._client.table_request(
                "POST", "user_profiles", operation="profile_write", params={"select": "*"},
                json={"user_id": self._user_id, "preferred_locale": locale}, prefer="return=representation",
            )
        if not rows:
            raise SupabaseDataError("profile_write")
        return UserProfile.model_validate(rows[0])


class SnapshotRepository:
    def __init__(self, client: SupabaseRestClient, user_id: str) -> None:
        self._client, self._user_id = client, user_id

    def read(self) -> StoredSnapshot | None:
        rows = self._client.table_request(
            "GET", "app_snapshots", operation="snapshot_read",
            params={
                "user_id": f"eq.{self._user_id}", "select": "payload,schema_version,updated_at", "limit": "1",
            },
        )
        if not rows:
            return None
        row = rows[0]
        return StoredSnapshot(row["schema_version"], row["payload"], row["updated_at"])

    def save(self, payload: CloudStatePayload) -> StoredSnapshot:
        current = self.read()
        body = {"payload": payload.persistence_dict(), "schema_version": 2}
        if current:
            rows = self._client.table_request(
                "PATCH", "app_snapshots", operation="snapshot_write",
                params={"user_id": f"eq.{self._user_id}", "select": "payload,schema_version,updated_at"},
                json=body, prefer="return=representation",
            )
        else:
            rows = self._client.table_request(
                "POST", "app_snapshots", operation="snapshot_write",
                params={"select": "payload,schema_version,updated_at"},
                json={"user_id": self._user_id, **body}, prefer="return=representation",
            )
        if not rows:
            raise SupabaseDataError("snapshot_write")
        row = rows[0]
        return StoredSnapshot(row["schema_version"], row["payload"], row["updated_at"])

    def delete(self) -> None:
        self._client.table_request(
            "DELETE", "app_snapshots", operation="snapshot_delete",
            params={"user_id": f"eq.{self._user_id}"}, prefer="return=minimal",
        )


class ConsentRepository:
    def __init__(self, client: SupabaseRestClient, user_id: str) -> None:
        self._client, self._user_id = client, user_id

    def read(self, statement_version: str) -> ConsentAcceptance | None:
        rows = self._client.table_request(
            "GET", "consent_acceptances", operation="consent_read",
            params={
                "user_id": f"eq.{self._user_id}", "purpose": "eq.cloud_sync",
                "statement_version": f"eq.{statement_version}", "select": "*", "limit": "1",
            },
        )
        return ConsentAcceptance.model_validate(rows[0]) if rows else None

    def accept(self, statement_version: str, locale: Locale) -> ConsentAcceptance:
        accepted_at = datetime.now(timezone.utc).isoformat()
        current = self.read(statement_version)
        filters = {
            "user_id": f"eq.{self._user_id}", "purpose": "eq.cloud_sync",
            "statement_version": f"eq.{statement_version}", "select": "*",
        }
        if current:
            rows = self._client.table_request(
                "PATCH", "consent_acceptances", operation="consent_write", params=filters,
                json={"locale": locale, "accepted_at": accepted_at, "withdrawn_at": None},
                prefer="return=representation",
            )
        else:
            rows = self._client.table_request(
                "POST", "consent_acceptances", operation="consent_write", params={"select": "*"},
                json={
                    "user_id": self._user_id, "purpose": "cloud_sync",
                    "statement_version": statement_version, "locale": locale,
                    "accepted_at": accepted_at, "withdrawn_at": None,
                }, prefer="return=representation",
            )
        if not rows:
            raise SupabaseDataError("consent_write")
        return ConsentAcceptance.model_validate(rows[0])

    def withdraw(self, statement_version: str) -> ConsentAcceptance:
        rows = self._client.table_request(
            "PATCH", "consent_acceptances", operation="consent_withdraw",
            params={
                "user_id": f"eq.{self._user_id}", "purpose": "eq.cloud_sync",
                "statement_version": f"eq.{statement_version}", "select": "*",
            },
            json={"withdrawn_at": datetime.now(timezone.utc).isoformat()}, prefer="return=representation",
        )
        if not rows:
            raise SupabaseDataError("consent_withdraw")
        return ConsentAcceptance.model_validate(rows[0])


class SupabaseServerStore:
    def __init__(self, client: SupabaseRestClient, user_id: str) -> None:
        self.profiles = UserProfileRepository(client, user_id)
        self.snapshots = SnapshotRepository(client, user_id)
        self.consents = ConsentRepository(client, user_id)
