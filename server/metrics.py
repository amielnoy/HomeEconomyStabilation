from __future__ import annotations

from collections import Counter
from os import environ
from threading import Lock
from time import monotonic

import httpx

from .config import read_supabase_config

_REQUEST_COUNTS: Counter[tuple[str, str, int]] = Counter()
_SUPABASE_COUNTS: Counter[tuple[str, int]] = Counter()
_SUPABASE_DURATIONS: dict[str, float] = {}
_LOCK = Lock()
_STARTED_AT = monotonic()
_METHODS = {"GET", "HEAD", "PUT", "DELETE", "POST", "PATCH", "OPTIONS"}
_SUPABASE_OPERATIONS = {
    "auth_verify", "profile_read", "profile_write", "snapshot_read", "snapshot_write", "snapshot_delete",
    "consent_read", "consent_write", "consent_withdraw",
}


def _route_name(path: str) -> str:
    return {
        "/api/health": "health",
        "/api/snapshots": "snapshots",
        "/api/profile": "profile",
        "/api/consents/cloud-sync": "cloud_consent",
        "/health": "container_health",
        "/metrics": "metrics",
    }.get(path, "other")


def record_response(method: str, path: str, status: int) -> None:
    """Record only bounded route names; raw paths and user identifiers are discarded."""
    with _LOCK:
        _REQUEST_COUNTS[(_route_name(path), method if method in _METHODS else "OTHER", status)] += 1


def record_supabase_response(operation: str, status: int, duration: float) -> None:
    """Record bounded metadata only; operation names never contain user data."""
    bounded_operation = operation if operation in _SUPABASE_OPERATIONS else "other"
    with _LOCK:
        _SUPABASE_COUNTS[(bounded_operation, status)] += 1
        _SUPABASE_DURATIONS[bounded_operation] = duration


def _probe_supabase() -> tuple[int, float]:
    config = read_supabase_config()
    if not config:
        return 0, 0.0
    started = monotonic()
    try:
        response = httpx.get(
            f"{config.url}/auth/v1/health",
            headers={"apikey": config.publishable_key},
            timeout=2.0,
        )
        return int(response.is_success), monotonic() - started
    except httpx.HTTPError:
        return 0, monotonic() - started


def _probe(name: str, url: str) -> tuple[str, int, float]:
    started = monotonic()
    try:
        response = httpx.get(url, timeout=2.0)
        return name, int(response.is_success), monotonic() - started
    except httpx.HTTPError:
        return name, 0, monotonic() - started


def render_metrics() -> str:
    web_origin = environ.get("MONITOR_WEB_ORIGIN", "http://web")
    scalar_origin = environ.get("MONITOR_SCALAR_ORIGIN", web_origin)
    probes = [
        _probe("application", f"{web_origin}/mazan-habait.html"),
        _probe("swagger", f"{web_origin}/api-docs.html"),
        _probe("scalar", f"{scalar_origin}/scalar-docs.html"),
    ]
    database_up, database_duration = _probe_supabase()
    lines = [
        "# HELP home_economy_process_uptime_seconds API process uptime.",
        "# TYPE home_economy_process_uptime_seconds gauge",
        f"home_economy_process_uptime_seconds {monotonic() - _STARTED_AT}",
        "# HELP home_economy_endpoint_up Whether a monitored endpoint returned a successful response.",
        "# TYPE home_economy_endpoint_up gauge",
        'home_economy_endpoint_up{endpoint="api"} 1',
        f'home_economy_supabase_up {database_up}',
        f'home_economy_supabase_probe_duration_seconds {database_duration}',
        "# HELP home_economy_endpoint_duration_seconds Duration of the latest endpoint probe.",
        "# TYPE home_economy_endpoint_duration_seconds gauge",
    ]
    for name, up, duration in probes:
        lines.append(f'home_economy_endpoint_up{{endpoint="{name}"}} {up}')
        lines.append(f'home_economy_endpoint_duration_seconds{{endpoint="{name}"}} {duration}')
    lines.extend([
        "# HELP home_economy_http_requests_total HTTP responses served by bounded route, method and status.",
        "# TYPE home_economy_http_requests_total counter",
    ])
    with _LOCK:
        counts = list(_REQUEST_COUNTS.items())
        supabase_counts = list(_SUPABASE_COUNTS.items())
        supabase_durations = list(_SUPABASE_DURATIONS.items())
    for (route, method, status), count in counts:
        lines.append(
            f'home_economy_http_requests_total{{route="{route}",method="{method}",status="{status}"}} {count}'
        )
    lines.extend([
        "# HELP home_economy_supabase_requests_total Supabase responses by bounded operation and status.",
        "# TYPE home_economy_supabase_requests_total counter",
    ])
    for (operation, status), count in supabase_counts:
        lines.append(f'home_economy_supabase_requests_total{{operation="{operation}",status="{status}"}} {count}')
    lines.extend([
        "# HELP home_economy_supabase_request_duration_seconds Latest Supabase operation duration.",
        "# TYPE home_economy_supabase_request_duration_seconds gauge",
    ])
    for operation, duration in supabase_durations:
        lines.append(f'home_economy_supabase_request_duration_seconds{{operation="{operation}"}} {duration}')
    return "\n".join(lines) + "\n"
