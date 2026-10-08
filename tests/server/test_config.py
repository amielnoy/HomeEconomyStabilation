from server.config import bearer_token, read_supabase_config, session_token


def test_configuration_fails_closed_and_accepts_only_publishable_https() -> None:
    assert read_supabase_config({}) is None
    assert read_supabase_config({"SUPABASE_URL": "http://example.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_x"}) is None
    assert read_supabase_config({"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "sb_secret_x"}) is None
    config = read_supabase_config({
        "SUPABASE_URL": "https://example.supabase.co/path",
        "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_example",
    })
    assert config is not None
    assert config.url == "https://example.supabase.co"


def test_bearer_token_parser_rejects_ambiguous_values() -> None:
    assert bearer_token("Bearer user.jwt.token") == "user.jwt.token"
    assert bearer_token("bearer user.jwt.token") is None
    assert bearer_token("Bearer token with spaces") is None


def test_session_token_applies_the_same_shape_check_bearer_token_does() -> None:
    assert session_token(None) is None
    assert session_token("") is None
    assert session_token("has a space") is None
    assert session_token("has\nnewline") is None
    assert session_token("valid.token-value_123~ok") == "valid.token-value_123~ok"
