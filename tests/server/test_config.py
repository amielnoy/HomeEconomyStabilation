from server.config import bearer_token, read_supabase_config


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
