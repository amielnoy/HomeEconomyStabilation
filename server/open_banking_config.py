from __future__ import annotations

from dataclasses import dataclass
from os import environ
from typing import Literal
from urllib.parse import urlparse

SourceKind = Literal["bank", "card_issuer"]


@dataclass(frozen=True, slots=True)
class OpenBankingSource:
    id: str
    kind: SourceKind
    name: str
    base_url: str
    authorization_url: str
    token_url: str


def _https(value: str) -> str | None:
    parsed = urlparse(value)
    return value if parsed.scheme == "https" and parsed.netloc else None


def _parse_line(line: str) -> OpenBankingSource | None:
    parts = line.split("|")
    if len(parts) != 6:
        return None
    source_id, kind, name, base_url, authorization_url, token_url = (part.strip() for part in parts)
    if kind not in ("bank", "card_issuer") or not source_id or not name:
        return None
    urls = (_https(base_url), _https(authorization_url), _https(token_url))
    if not all(urls):
        return None
    return OpenBankingSource(
        id=source_id, kind=kind, name=name,
        base_url=urls[0], authorization_url=urls[1], token_url=urls[2],  # type: ignore[arg-type]
    )


def read_sources(env: dict[str, str] | None = None) -> list[OpenBankingSource]:
    values = env if env is not None else environ
    raw = values.get("OPEN_BANKING_SOURCES", "")
    sources = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        parsed = _parse_line(line)
        if parsed:
            sources.append(parsed)
    return sources


def sandbox_enabled(env: dict[str, str] | None = None) -> bool:
    values = env if env is not None else environ
    return values.get("OPEN_BANKING_SANDBOX") == "1"


def licence_id(env: dict[str, str] | None = None) -> str | None:
    values = env if env is not None else environ
    return values.get("OPEN_BANKING_LICENCE_ID") or None


def client_id_for(source_id: str, env: dict[str, str] | None = None) -> str | None:
    values = env if env is not None else environ
    return values.get(f"OPEN_BANKING_CLIENT_ID_{source_id.upper()}") or None
