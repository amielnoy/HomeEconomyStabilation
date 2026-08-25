from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from time import monotonic

MAX_REQUEST_BYTES = 1_010_000
MAX_REQUESTS = 60
WINDOW_SECONDS = 60
MAX_TRACKED_CLIENTS = 10_000


@dataclass(frozen=True, slots=True)
class GuardFailure:
    status: int
    code: str
    retry_after: int | None = None


class SnapshotRequestGuard:
    def __init__(self) -> None:
        self._buckets: dict[str, tuple[int, float]] = {}
        self._lock = Lock()

    def check(
        self,
        *,
        method: str,
        client_key: str,
        content_type: str | None,
        content_length: str | None,
        now: float | None = None,
    ) -> GuardFailure | None:
        current_time = monotonic() if now is None else now
        with self._lock:
            count, resets_at = self._buckets.get(client_key[:100], (0, current_time + WINDOW_SECONDS))
            if resets_at <= current_time:
                count, resets_at = 0, current_time + WINDOW_SECONDS
            count += 1
            self._buckets[client_key[:100]] = (count, resets_at)
            if len(self._buckets) > MAX_TRACKED_CLIENTS:
                expired = [key for key, (_, reset) in self._buckets.items() if reset <= current_time]
                for key in expired:
                    self._buckets.pop(key, None)
                while len(self._buckets) > MAX_TRACKED_CLIENTS:
                    self._buckets.pop(next(iter(self._buckets)))
            if count > MAX_REQUESTS:
                return GuardFailure(429, "rate_limited", max(1, int(resets_at - current_time)))

        if method != "PUT":
            return None
        if not (content_type or "").lower().startswith("application/json"):
            return GuardFailure(415, "json_content_type_required")
        try:
            declared_size = int(content_length or "0")
        except ValueError:
            declared_size = 0
        if declared_size > MAX_REQUEST_BYTES:
            return GuardFailure(413, "snapshot_too_large")
        return None

    def rate_limit_only(self, *, client_key: str, now: float | None = None) -> GuardFailure | None:
        """Routes that validate their own bodies still want the shared rate limit.

        Passing method="GET" to check() achieved this by accident and read as though
        the request really were a GET; this says what is meant.
        """
        return self.check(
            method="GET", client_key=client_key, content_type=None, content_length=None, now=now,
        )

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()
