import json
import logging

from fastapi.testclient import TestClient

from server.app import app
from server.logging_config import (
    DailyCappedHandler,
    JsonLinesFormatter,
    configure_logging,
    log_event,
    route_name,
)


def _read(path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_writes_json_lines_in_the_shared_record_shape(tmp_path) -> None:
    target = tmp_path / "api.log"
    configure_logging(level="info", path=str(target))

    log_event("info", "http.request", route="snapshots", method="GET", status=200)

    records = _read(target)
    assert len(records) == 1
    assert records[0]["source"] == "api"
    assert records[0]["event"] == "http.request"
    assert records[0]["level"] == "info"
    assert records[0]["context"] == {"route": "snapshots", "method": "GET", "status": 200}
    # The browser writes the same field, and the two are read together by sorting on it.
    assert records[0]["ts"].endswith("Z")


def test_uses_the_same_level_names_as_the_browser(tmp_path) -> None:
    target = tmp_path / "api.log"
    configure_logging(level="debug", path=str(target))

    for level in ("debug", "info", "warn", "error"):
        log_event(level, f"event.{level}")

    assert [record["level"] for record in _read(target)] == ["debug", "info", "warn", "error"]


def test_drops_records_below_the_configured_level(tmp_path) -> None:
    target = tmp_path / "api.log"
    configure_logging(level="warn", path=str(target))

    log_event("info", "event.quiet")
    log_event("error", "event.loud")

    assert [record["event"] for record in _read(target)] == ["event.loud"]


def test_reconfiguring_does_not_stack_handlers(tmp_path) -> None:
    """A reloader calling this twice would otherwise write every line once per call."""
    target = tmp_path / "api.log"
    configure_logging(level="info", path=str(target))
    configure_logging(level="info", path=str(target))

    log_event("info", "event.once")

    assert len(_read(target)) == 1


def test_records_only_bounded_route_names() -> None:
    assert route_name("/api/snapshots") == "snapshots"
    assert route_name("/api/health") == "health"
    # A crafted path must not write an unbounded distinct value into the log.
    assert route_name("/api/snapshots/../../etc/passwd") == "other"
    assert route_name("/api/user/12345/statement") == "other"


def test_an_exception_is_recorded_by_type_without_its_traceback(tmp_path) -> None:
    """A traceback can carry values taken from the request; the type alone cannot."""
    target = tmp_path / "api.log"
    logger = configure_logging(level="info", path=str(target))

    try:
        raise ValueError("account 04-279-661711 rejected")
    except ValueError:
        logger.error("supabase.write", exc_info=True)

    records = _read(target)
    assert records[0]["context"]["error"] == "ValueError"
    assert "04-279-661711" not in target.read_text(encoding="utf-8")


def test_every_request_is_logged_with_bounded_metadata(tmp_path) -> None:
    target = tmp_path / "api.log"
    configure_logging(level="info", path=str(target))

    TestClient(app).get("/api/health")

    request_records = [record for record in _read(target) if record["event"] == "http.request"]
    assert len(request_records) == 1
    context = request_records[0]["context"]
    assert context["route"] == "health"
    assert context["method"] == "GET"
    assert context["status"] == 200
    assert isinstance(context["duration_ms"], (int, float))


def test_the_formatter_never_emits_a_newline_inside_a_record() -> None:
    """One record per line is what makes the file greppable and streamable."""
    record = logging.LogRecord("home_economy", logging.INFO, __file__, 1, "event.multi", None, None)
    record.context = {"note": "first\nsecond"}

    formatted = JsonLinesFormatter().format(record)

    assert "\n" not in formatted
    assert json.loads(formatted)["context"]["note"] == "first\nsecond"


def test_keeps_a_dated_backup_for_each_day(tmp_path) -> None:
    """Rotation is by day, so yesterday's records stay readable under yesterday's name."""
    target = tmp_path / "api.log"
    configure_logging(level="info", path=str(target))
    log_event("info", "event.yesterday")

    handler = logging.getLogger("home_economy").handlers[0]
    assert isinstance(handler, DailyCappedHandler)
    handler.doRollover()
    log_event("info", "event.today")

    backups = sorted(path.name for path in tmp_path.iterdir() if path.name != "api.log")
    assert len(backups) == 1
    # The backup is named for the day it covers rather than by an index.
    assert backups[0].startswith("api.log.")
    assert "event.yesterday" in (tmp_path / backups[0]).read_text(encoding="utf-8")
    assert "event.today" in target.read_text(encoding="utf-8")


def test_rotation_is_anchored_to_utc_like_the_records(tmp_path) -> None:
    """A local-time boundary would file a day's first records under the day before."""
    configure_logging(level="info", path=str(tmp_path / "api.log"))

    handler = logging.getLogger("home_economy").handlers[0]

    assert isinstance(handler, DailyCappedHandler)
    assert handler.utc is True
    assert handler.when == "MIDNIGHT"


def test_retention_bounds_how_many_days_are_kept(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("LOG_RETENTION_DAYS", "2")
    configure_logging(level="info", path=str(tmp_path / "api.log"))

    handler = logging.getLogger("home_economy").handlers[0]

    assert handler.backupCount == 2


def test_a_misconfigured_retention_does_not_turn_rotation_off(tmp_path, monkeypatch) -> None:
    """An empty or zero value must not mean "keep nothing" or "keep everything"."""
    for value in ("0", "-1", "many", ""):
        monkeypatch.setenv("LOG_RETENTION_DAYS", value)
        configure_logging(level="info", path=str(tmp_path / "api.log"))

        assert logging.getLogger("home_economy").handlers[0].backupCount == 14


def test_one_days_burst_cannot_grow_past_the_size_cap(tmp_path) -> None:
    """Waiting for midnight must not let a single day fill the disk.

    The standard handler names a backup after its day and, finding that name taken,
    declines to roll again — so without numbering the later copies the cap would hold only
    until the day's first rollover and the file would grow unbounded after it.
    """
    target = tmp_path / "api.log"
    configure_logging(level="info", path=str(target))
    handler = logging.getLogger("home_economy").handlers[0]
    assert isinstance(handler, DailyCappedHandler)
    handler._max_bytes = 400

    for index in range(40):
        log_event("info", "event.burst", index=index)

    assert target.stat().st_size < 400
    backups = sorted(path.name for path in tmp_path.iterdir() if path.name != "api.log")
    assert len(backups) > 1
    # Every copy still carries the day it covers.
    assert all(name.startswith("api.log.2") for name in backups)


def test_retention_also_prunes_the_numbered_copies(tmp_path, monkeypatch) -> None:
    """A numbered copy the pruning does not recognise would accumulate forever."""
    monkeypatch.setenv("LOG_RETENTION_DAYS", "3")
    target = tmp_path / "api.log"
    configure_logging(level="info", path=str(target))
    handler = logging.getLogger("home_economy").handlers[0]
    assert isinstance(handler, DailyCappedHandler)
    handler._max_bytes = 300

    for index in range(60):
        log_event("info", "event.burst", index=index)

    backups = [path.name for path in tmp_path.iterdir() if path.name != "api.log"]
    assert len(backups) == 3


def test_falls_back_to_the_stream_when_the_filesystem_is_read_only(tmp_path) -> None:
    """A serverless deployment has no writable working directory.

    This ran from the request middleware, so the OSError raised while creating the log
    directory answered every API request with a 500 until logging gave way instead.
    """
    import os
    import stat

    read_only = tmp_path / "ro"
    read_only.mkdir()
    os.chmod(read_only, stat.S_IRUSR | stat.S_IXUSR)

    try:
        logger = configure_logging(level="info", path=str(read_only / "logs" / "api.log"))

        assert isinstance(logger.handlers[0], logging.StreamHandler)
        assert not isinstance(logger.handlers[0], DailyCappedHandler)
        # And a request may still be logged without raising.
        log_event("info", "http.request", route="health", status=200)
    finally:
        os.chmod(read_only, stat.S_IRWXU)


def test_a_request_is_answered_even_when_logging_cannot_write(tmp_path, monkeypatch) -> None:
    """The contract that matters: the API keeps working whatever logging can or cannot do."""
    import os
    import stat

    read_only = tmp_path / "ro"
    read_only.mkdir()
    os.chmod(read_only, stat.S_IRUSR | stat.S_IXUSR)
    monkeypatch.setenv("LOG_FILE", str(read_only / "logs" / "api.log"))

    try:
        logging.getLogger("home_economy").handlers.clear()
        response = TestClient(app).get("/api/health")

        assert response.status_code == 200
        assert response.json() == {"status": "ok", "service": "home-economy-api"}
    finally:
        os.chmod(read_only, stat.S_IRWXU)
