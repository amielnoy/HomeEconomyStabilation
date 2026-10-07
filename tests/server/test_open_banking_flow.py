from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from server.auth_flow import create_challenge
from server.open_banking_config import OpenBankingSource
from server.open_banking_flow import (
    OpenBankingRefreshRefused, TokenPair, authorize_url, exchange_code, parse_token_response, refresh_tokens,
)

SOURCE = OpenBankingSource(
    id="hapoalim", kind="bank", name="בנק הפועלים",
    base_url="https://api.poalimdev.co.il/psd2/sandbox",
    authorization_url="https://api.poalimdev.co.il/oauth/authorize",
    token_url="https://api.poalimdev.co.il/oauth/token",
)


def test_the_authorize_url_carries_the_pkce_challenge_and_client_id() -> None:
    challenge = create_challenge()

    url = authorize_url(SOURCE, "client-abc", challenge, "https://app.example/api/open-banking/callback")

    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    assert parsed.netloc == "api.poalimdev.co.il"
    assert parsed.path == "/oauth/authorize"
    assert query["client_id"] == ["client-abc"]
    assert query["code_challenge"] == [challenge.challenge]
    assert query["code_challenge_method"] == ["S256"]
    assert query["state"] == [challenge.state]
    assert query["redirect_uri"] == ["https://app.example/api/open-banking/callback"]
    assert query["response_type"] == ["code"]
    assert challenge.verifier not in url


def test_a_token_response_without_both_tokens_is_not_a_pair() -> None:
    assert parse_token_response({"access_token": "a", "expires_in": 3600}) is None
    assert parse_token_response({"refresh_token": "r", "expires_in": 3600}) is None
    assert parse_token_response("not-a-mapping") is None


def test_a_token_pairs_lifetime_is_bounded() -> None:
    pair = parse_token_response({"access_token": "a", "refresh_token": "r", "expires_in": 10_000_000})
    assert pair == TokenPair(access_token="a", refresh_token="r", expires_in=24 * 3600)


def test_exchange_code_posts_the_verifier_and_client_id(monkeypatch) -> None:
    captured = {}

    def fake_post(url, data=None, timeout=None):
        captured["url"] = url
        captured["data"] = data
        return httpx.Response(200, json={"access_token": "a", "refresh_token": "r", "expires_in": 3600})

    monkeypatch.setattr(httpx, "post", fake_post)

    pair = exchange_code(SOURCE, "client-abc", "auth-code", "verifier-value", "https://app.example/callback")

    assert pair == TokenPair(access_token="a", refresh_token="r", expires_in=3600)
    assert captured["url"] == SOURCE.token_url
    assert captured["data"] == {
        "grant_type": "authorization_code", "code": "auth-code", "code_verifier": "verifier-value",
        "redirect_uri": "https://app.example/callback", "client_id": "client-abc",
    }


def test_exchange_code_returns_none_on_a_non_200_or_network_failure(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(400, json={"error": "invalid_grant"}))
    assert exchange_code(SOURCE, "client-abc", "code", "verifier", "https://app.example/callback") is None

    def raise_network_error(*a, **k):
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(httpx, "post", raise_network_error)
    assert exchange_code(SOURCE, "client-abc", "code", "verifier", "https://app.example/callback") is None


def test_exchange_code_returns_none_on_malformed_json_response(monkeypatch) -> None:
    # 200 response with invalid JSON (e.g., truncated or HTML error page)
    def fake_post_malformed(*a, **k):
        return httpx.Response(200, text="<!DOCTYPE html><html>Internal error</html>")

    monkeypatch.setattr(httpx, "post", fake_post_malformed)
    assert exchange_code(SOURCE, "client-abc", "code", "verifier", "https://app.example/callback") is None


def test_refresh_tokens_returns_none_on_malformed_json_response(monkeypatch) -> None:
    # 200 response with invalid JSON (e.g., truncated or HTML error page)
    def fake_post_malformed(*a, **k):
        return httpx.Response(200, text="<!DOCTYPE html><html>Internal error</html>")

    monkeypatch.setattr(httpx, "post", fake_post_malformed)
    assert refresh_tokens(SOURCE, "client-abc", "old-refresh-token") is None


@pytest.mark.parametrize("status, body", [
    (400, {"error": "invalid_grant"}),
    (401, {"error": "invalid_client"}),
    (400, None),  # a definitive refusal is the status, whatever (or no) body comes with it
])
def test_refresh_tokens_raises_refused_on_a_definitive_bank_refusal(monkeypatch, status, body) -> None:
    response = httpx.Response(status, json=body) if body is not None else httpx.Response(status, text="")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: response)

    with pytest.raises(OpenBankingRefreshRefused) as exc_info:
        refresh_tokens(SOURCE, "client-abc", "old-refresh-token")

    assert exc_info.value.status_code == status


def _raise(error: Exception):
    def raiser(*a, **k):
        raise error
    return raiser


@pytest.mark.parametrize("fake_post", [
    _raise(httpx.ConnectError("boom")),
    _raise(httpx.ReadTimeout("slow")),
    lambda *a, **k: httpx.Response(500, json={"error": "server_error"}),
    lambda *a, **k: httpx.Response(502, text="Bad Gateway"),
    lambda *a, **k: httpx.Response(503, text=""),
    lambda *a, **k: httpx.Response(200, text="<!DOCTYPE html><html>Internal error</html>"),
    lambda *a, **k: httpx.Response(200, json=["not", "a", "mapping"]),
    lambda *a, **k: httpx.Response(200, json={"access_token": "a", "expires_in": 3600}),
], ids=["network-error", "timeout", "500", "502", "503", "non-json-200", "json-array-200", "missing-refresh-200"])
def test_refresh_tokens_treats_a_transient_failure_as_none_not_a_refusal(monkeypatch, fake_post) -> None:
    monkeypatch.setattr(httpx, "post", fake_post)
    assert refresh_tokens(SOURCE, "client-abc", "old-refresh-token") is None


def test_exchange_code_still_returns_none_rather_than_raising_on_a_refusal(monkeypatch) -> None:
    # Only refresh_tokens distinguishes a refusal; exchange_code's contract is unchanged.
    for status in (400, 401):
        monkeypatch.setattr(httpx, "post", lambda *a, _s=status, **k: httpx.Response(_s, json={"error": "invalid_grant"}))
        assert exchange_code(SOURCE, "client-abc", "code", "verifier", "https://app.example/callback") is None


def test_refresh_tokens_posts_the_refresh_grant(monkeypatch) -> None:
    captured = {}

    def fake_post(url, data=None, timeout=None):
        captured["data"] = data
        return httpx.Response(200, json={"access_token": "a2", "refresh_token": "r2", "expires_in": 1800})

    monkeypatch.setattr(httpx, "post", fake_post)

    pair = refresh_tokens(SOURCE, "client-abc", "old-refresh-token")

    assert pair == TokenPair(access_token="a2", refresh_token="r2", expires_in=1800)
    assert captured["data"] == {
        "grant_type": "refresh_token", "refresh_token": "old-refresh-token", "client_id": "client-abc",
    }
