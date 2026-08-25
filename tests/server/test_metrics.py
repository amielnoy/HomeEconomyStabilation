from collections import Counter

import server.metrics as metrics


def test_metrics_collapse_unknown_routes_methods_and_operations(monkeypatch) -> None:
    monkeypatch.setattr(metrics, "_REQUEST_COUNTS", Counter())
    monkeypatch.setattr(metrics, "_SUPABASE_COUNTS", Counter())
    monkeypatch.setattr(metrics, "_SUPABASE_DURATIONS", {})
    monkeypatch.setattr(metrics, "_probe", lambda name, _url: (name, 1, 0.01))
    monkeypatch.setattr(metrics, "_probe_supabase", lambda: (1, 0.01))

    metrics.record_response("BREW", "/api/users/private@example.test", 418)
    metrics.record_supabase_response("user-private@example.test", 500, 0.2)
    rendered = metrics.render_metrics()

    assert 'route="other",method="OTHER",status="418"' in rendered
    assert 'operation="other",status="500"' in rendered
    assert "private@example.test" not in rendered


def test_endpoint_probes_are_cached_so_a_scrape_cannot_be_used_as_an_amplifier() -> None:
    """Every scrape used to fire four live outbound requests at a 2s timeout each."""
    metrics.reset_probe_cache()
    calls: list[str] = []

    def fake_get(url: str, **_: object):
        calls.append(url)
        raise metrics.httpx.HTTPError("offline")

    original = metrics.httpx.get
    metrics.httpx.get = fake_get  # type: ignore[assignment]
    try:
        metrics.render_metrics()
        first = len(calls)
        assert first > 0
        metrics.render_metrics()
        metrics.render_metrics()
        assert len(calls) == first, "repeat scrapes must be served from the probe cache"
    finally:
        metrics.httpx.get = original  # type: ignore[assignment]
        metrics.reset_probe_cache()
