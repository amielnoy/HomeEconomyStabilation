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
