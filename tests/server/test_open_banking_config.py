from server.open_banking_config import OpenBankingSource, client_id_for, licence_id, read_sources, sandbox_enabled

HAPOALIM_LINE = (
    "hapoalim|bank|בנק הפועלים|https://api.poalimdev.co.il/psd2/sandbox"
    "|https://api.poalimdev.co.il/oauth/authorize|https://api.poalimdev.co.il/oauth/token"
)


def test_a_well_formed_source_line_parses_into_a_source() -> None:
    sources = read_sources({"OPEN_BANKING_SOURCES": HAPOALIM_LINE})
    assert sources == [
        OpenBankingSource(
            id="hapoalim", kind="bank", name="בנק הפועלים",
            base_url="https://api.poalimdev.co.il/psd2/sandbox",
            authorization_url="https://api.poalimdev.co.il/oauth/authorize",
            token_url="https://api.poalimdev.co.il/oauth/token",
        )
    ]


def test_an_http_line_is_dropped_rather_than_trusted() -> None:
    line = HAPOALIM_LINE.replace("https://api.poalimdev.co.il/psd2/sandbox", "http://api.poalimdev.co.il/psd2/sandbox")
    assert read_sources({"OPEN_BANKING_SOURCES": line}) == []


def test_a_malformed_line_is_dropped_not_guessed_at() -> None:
    assert read_sources({"OPEN_BANKING_SOURCES": "too|few|fields"}) == []
    assert read_sources({"OPEN_BANKING_SOURCES": HAPOALIM_LINE.replace("bank", "savings", 1)}) == []


def test_multiple_sources_are_newline_separated() -> None:
    other = HAPOALIM_LINE.replace("hapoalim", "other")
    sources = read_sources({"OPEN_BANKING_SOURCES": f"{HAPOALIM_LINE}\n{other}"})
    assert [s.id for s in sources] == ["hapoalim", "other"]


def test_sandbox_and_licence_flags_read_from_the_environment() -> None:
    assert sandbox_enabled({}) is False
    assert sandbox_enabled({"OPEN_BANKING_SANDBOX": "1"}) is True
    assert licence_id({}) is None
    assert licence_id({"OPEN_BANKING_LICENCE_ID": "isa-12345"}) == "isa-12345"


def test_client_id_is_read_by_upper_cased_source_suffix() -> None:
    env = {"OPEN_BANKING_CLIENT_ID_HAPOALIM": "client-abc"}
    assert client_id_for("hapoalim", env) == "client-abc"
    assert client_id_for("missing", env) is None
