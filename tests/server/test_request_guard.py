from server.request_guard import SnapshotRequestGuard


def test_write_requires_json_and_a_bounded_declared_size() -> None:
    guard = SnapshotRequestGuard()
    assert guard.check(method="PUT", client_key="a", content_type="text/plain", content_length=None).status == 415
    assert guard.check(
        method="PUT", client_key="b", content_type="application/json", content_length="1010001",
    ).status == 413


def test_rate_limit_resets_without_persisting_request_data() -> None:
    guard = SnapshotRequestGuard()
    for _ in range(60):
        assert guard.check(method="GET", client_key="hashed-client", content_type=None, content_length=None, now=1) is None
    failure = guard.check(method="GET", client_key="hashed-client", content_type=None, content_length=None, now=1)
    assert failure is not None and failure.status == 429 and failure.retry_after
    assert guard.check(method="GET", client_key="hashed-client", content_type=None, content_length=None, now=62) is None
