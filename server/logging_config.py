"""Structured logging for the API, in the same record shape the browser writes.

The browser cannot write a file and keeps a bounded in-memory ring instead; here there is
a filesystem, so the same JSON-lines records are appended to a rotating file. One shape and
one set of level names means a browser download and a server log can be concatenated,
sorted by ``ts`` and told apart by ``source``.

The privacy boundary is the one already drawn in ``metrics.py``: bounded route names, never
raw paths, never identifiers, never request or response bodies. A log that recorded those
would reintroduce, in a file, exactly what the snapshot API was designed not to keep.
"""

from __future__ import annotations

import json
import logging
import re
from os.path import exists
from datetime import datetime, timezone
from logging.handlers import TimedRotatingFileHandler
from os import environ, makedirs
from os.path import dirname
from typing import Any

LOGGER_NAME = "home_economy"

# Kept identical to the browser's levels so one reader can filter both.
_LEVELS = {"debug": logging.DEBUG, "info": logging.INFO, "warn": logging.WARNING, "error": logging.ERROR}

# A dated copy is kept for each of the last two weeks, which covers a report that arrives
# on Monday about something that happened over the weekend. The limit counts backup files,
# which is the same as days unless a day was busy enough to also roll on size.
_BACKUP_COUNT = 14

# Rotation is by day, but a burst inside one day must not be able to fill the disk while
# waiting for midnight, so the file also rolls early once it reaches this size.
_MAX_BYTES = 2 * 1024 * 1024


class DailyCappedHandler(TimedRotatingFileHandler):
    """Rolls at midnight UTC, and early if one day's traffic would grow past the cap.

    The standard library gives you one or the other: TimedRotatingFileHandler keeps a dated
    copy per day but will happily let a single day grow without limit, while
    RotatingFileHandler caps the size but names files by an index that says nothing about
    when they were written. Backups are wanted by day and the disk still has to be bounded,
    so the size check is added to the timed handler rather than the other way round.

    Rotation is anchored to UTC because the records are: a file boundary in local time
    would put the day's first records in yesterday's file twice a year.
    """

    def __init__(self, filename: str, backup_count: int, max_bytes: int) -> None:
        super().__init__(
            filename, when="midnight", backupCount=backup_count, encoding="utf-8", delay=True, utc=True,
        )
        self._max_bytes = max_bytes
        # Widened so that the ".1" copies below are still recognised as this handler's
        # backups. Without this they match nothing, are never counted against the retention
        # limit, and accumulate for as long as the process runs.
        self.extMatch = re.compile(r"^\d{4}-\d{2}-\d{2}(\.\d+)?$", re.ASCII)

    def rotation_filename(self, default_name: str) -> str:
        """Name a backup for its day, and number it when the day has already rolled.

        The standard handler names the backup after the day and, finding that name taken,
        declines to roll at all — so a second rollover inside one day silently does nothing
        and the size cap holds only until the first. Numbering the later copies keeps both
        guarantees: a day's records stay under that day's name, and the file still rolls
        whenever it grows past the cap.
        """
        if not exists(default_name):
            return default_name
        index = 1
        while exists(f"{default_name}.{index}"):
            index += 1
        return f"{default_name}.{index}"

    def shouldRollover(self, record: logging.LogRecord) -> int:  # noqa: N802 - stdlib spelling
        if super().shouldRollover(record):
            return 1
        if self._max_bytes <= 0:
            return 0
        if self.stream is None:
            self.stream = self._open()
        message = f"{self.format(record)}{self.terminator}".encode("utf-8")
        self.stream.seek(0, 2)
        return 1 if self.stream.tell() + len(message) >= self._max_bytes else 0


# Anything not named here is recorded as "other", so a crafted URL cannot write unbounded
# distinct values into the log — the same rule the metrics labels follow.
_ROUTES = {
    "/api/health": "health",
    "/api/snapshots": "snapshots",
    "/api/profile": "profile",
    "/api/consents/cloud-sync": "cloud_consent",
    "/health": "container_health",
    "/metrics": "metrics",
}


def route_name(path: str) -> str:
    """Bounded route label. Raw paths never reach the log."""
    return _ROUTES.get(path, "other")


class JsonLinesFormatter(logging.Formatter):
    """One JSON object per line, matching the browser's record shape."""

    def format(self, record: logging.LogRecord) -> str:
        level = record.levelname.lower()
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": "warn" if level == "warning" else level,
            "source": "api",
            "event": record.getMessage(),
        }
        context = getattr(record, "context", None)
        if isinstance(context, dict) and context:
            payload["context"] = context
        if record.exc_info:
            # The type and message only: a traceback can carry values from the request.
            exception = record.exc_info[1]
            payload["context"] = {**payload.get("context", {}), "error": type(exception).__name__}
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _positive_int(value: str | None, fallback: int) -> int:
    """A misconfigured retention must not silently turn rotation off."""
    try:
        parsed = int(value) if value is not None else fallback
    except ValueError:
        return fallback
    return parsed if parsed > 0 else fallback


def configure_logging(level: str | None = None, path: str | None = None) -> logging.Logger:
    """Install the file handler once and return the application logger.

    ``LOG_LEVEL``, ``LOG_FILE`` and ``LOG_RETENTION_DAYS`` override the defaults, so raising
    the level on a running deployment does not need a code change. Repeated calls are safe: handlers are replaced
    rather than stacked, which is what otherwise multiplies every line under a reloader.
    """
    resolved_level = (level or environ.get("LOG_LEVEL") or "info").lower()
    resolved_path = path or environ.get("LOG_FILE") or "logs/api.log"

    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(_LEVELS.get(resolved_level, logging.INFO))
    # The application owns this logger; letting records climb to the root would print them
    # a second time through whatever the host has configured there.
    logger.propagate = False

    for handler in list(logger.handlers):
        logger.removeHandler(handler)
        handler.close()

    directory = dirname(resolved_path)
    if directory:
        makedirs(directory, exist_ok=True)

    retention = _positive_int(environ.get("LOG_RETENTION_DAYS"), _BACKUP_COUNT)
    handler = DailyCappedHandler(resolved_path, backup_count=retention, max_bytes=_MAX_BYTES)
    handler.setFormatter(JsonLinesFormatter())
    logger.addHandler(handler)
    return logger


def get_logger() -> logging.Logger:
    """The application logger, configured on first use."""
    logger = logging.getLogger(LOGGER_NAME)
    if not logger.handlers:
        return configure_logging()
    return logger


def log_event(level: str, event: str, **context: Any) -> None:
    """Record a bounded event name with bounded context values."""
    logger = get_logger()
    logger.log(_LEVELS.get(level, logging.INFO), event, extra={"context": context})
