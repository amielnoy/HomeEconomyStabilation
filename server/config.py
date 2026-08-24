from __future__ import annotations

from dataclasses import dataclass
from os import environ
from urllib.parse import urlparse


@dataclass(frozen=True, slots=True)
class SupabaseConfig:
    url: str
    publishable_key: str


def read_supabase_config(env: dict[str, str] | None = None) -> SupabaseConfig | None:
    values = env if env is not None else environ
    url = values.get("SUPABASE_URL", "")
    key = values.get("SUPABASE_PUBLISHABLE_KEY", "")
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or not key.startswith("sb_publishable_")
    ):
        return None
    return SupabaseConfig(url=f"https://{parsed.netloc}", publishable_key=key)


def bearer_token(header: str | None) -> str | None:
    if not header or not header.startswith("Bearer "):
        return None
    token = header.removeprefix("Bearer ")
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._~-")
    return token if token and all(character in allowed for character in token) else None
