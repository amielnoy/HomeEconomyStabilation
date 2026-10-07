import httpx
import pytest

from server.open_banking_config import OpenBankingSource
from server.open_banking_sync import pull_transactions

SOURCE = OpenBankingSource(
    id="hapoalim", kind="bank", name="בנק הפועלים",
    base_url="https://api.poalimdev.co.il/psd2/sandbox",
    authorization_url="https://api.poalimdev.co.il/oauth/authorize",
    token_url="https://api.poalimdev.co.il/oauth/token",
)

CARD_ISSUER_SOURCE = OpenBankingSource(
    id="visa", kind="card_issuer", name="Visa",
    base_url="https://api.visa.sandbox/psd2/sandbox",
    authorization_url="https://api.visa.sandbox/oauth/authorize",
    token_url="https://api.visa.sandbox/oauth/token",
)

SANDBOX_RESPONSE = {
    "transactions": {
        "booked": [
            {
                "transactionId": "txn-1",
                "bookingDate": "2026-10-04",
                "valueDate": "2026-10-04",
                "transactionAmount": {"amount": "-124.13", "currency": "ILS"},
                "remittanceInformationUnstructured": "הראל-ביטוח בריאות",
            },
            {
                "transactionId": "txn-2",
                "bookingDate": "2026-10-01",
                "valueDate": "2026-10-01",
                "transactionAmount": {"amount": "8500.00", "currency": "ILS"},
                "remittanceInformationUnstructured": "משכורת",
            },
        ],
        "pending": [],
    }
}


def test_booked_transactions_map_into_the_domain_model(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: httpx.Response(200, json=SANDBOX_RESPONSE))

    rows = pull_transactions(SOURCE, "access-token")

    assert [row.id for row in rows] == ["txn-1", "txn-2"]
    expense, income = rows
    assert expense.out == 124.13 and expense.incoming == 0
    assert income.out == 0 and income.incoming == 8500.0
    assert expense.src == "open-banking"
    assert expense.source == "bank"
    assert expense.pending is False


def test_pending_transactions_are_included_and_flagged(monkeypatch) -> None:
    response = {
        "transactions": {
            "booked": [],
            "pending": [{
                "transactionId": "txn-3", "bookingDate": "2026-10-06", "valueDate": "2026-10-06",
                "transactionAmount": {"amount": "-9.90", "currency": "ILS"},
                "remittanceInformationUnstructured": "קפה",
            }],
        }
    }
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: httpx.Response(200, json=response))

    rows = pull_transactions(SOURCE, "access-token")

    assert rows[0].pending is True


def test_a_description_carrying_an_identifier_is_redacted_not_stored_raw(monkeypatch) -> None:
    response = {
        "transactions": {
            "booked": [{
                "transactionId": "txn-4", "bookingDate": "2026-10-04", "valueDate": "2026-10-04",
                "transactionAmount": {"amount": "-10.00", "currency": "ILS"},
                "remittanceInformationUnstructured": "חשבון 123-4567890",
            }],
            "pending": [],
        }
    }
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: httpx.Response(200, json=response))

    rows = pull_transactions(SOURCE, "access-token")

    assert "123-4567890" not in rows[0].desc
    assert "[redacted]" in rows[0].desc or "redacted" in rows[0].desc.lower()


def test_a_non_200_response_yields_no_rows_rather_than_raising(monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: httpx.Response(401, json={"error": "invalid_token"}))
    assert pull_transactions(SOURCE, "access-token") == []


def test_a_row_that_fails_model_validation_is_dropped_not_fatal(monkeypatch) -> None:
    response = {
        "transactions": {
            "booked": [
                {"transactionId": "txn-5", "bookingDate": "2026-10-04", "valueDate": "2026-10-04",
                 "transactionAmount": {"amount": "not-a-number", "currency": "ILS"},
                 "remittanceInformationUnstructured": "broken row"},
                {"transactionId": "txn-6", "bookingDate": "2026-10-04", "valueDate": "2026-10-04",
                 "transactionAmount": {"amount": "-5.00", "currency": "ILS"},
                 "remittanceInformationUnstructured": "good row"},
            ],
            "pending": [],
        }
    }
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: httpx.Response(200, json=response))

    rows = pull_transactions(SOURCE, "access-token")

    assert [row.id for row in rows] == ["txn-6"]


def test_card_issuer_source_maps_to_card_transaction_source(monkeypatch) -> None:
    response = {
        "transactions": {
            "booked": [{
                "transactionId": "txn-card-1", "bookingDate": "2026-10-04", "valueDate": "2026-10-04",
                "transactionAmount": {"amount": "-50.00", "currency": "ILS"},
                "remittanceInformationUnstructured": "restaurant",
            }],
            "pending": [],
        }
    }
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: httpx.Response(200, json=response))

    rows = pull_transactions(CARD_ISSUER_SOURCE, "access-token")

    assert len(rows) == 1
    assert rows[0].source == "card"
    assert rows[0].id == "txn-card-1"


@pytest.mark.parametrize("response", [
    httpx.Response(200, text="<!DOCTYPE html><html>Internal error</html>"),
    httpx.Response(200, text=""),
    httpx.Response(200, json=["not", "an", "object"]),
    httpx.Response(200, json="just a string"),
    httpx.Response(200, json=None),
    httpx.Response(200, json={"transactions": ["not", "an", "object"]}),
    httpx.Response(200, json={"transactions": None}),
    httpx.Response(200, json={"transactions": {"booked": "not-a-list", "pending": {"a": 1}}}),
    httpx.Response(200, json={"transactions": {"booked": ["not-a-row", 7, None], "pending": []}}),
    httpx.Response(200, json={"transactions": {"booked": [{"transactionId": "t", "transactionAmount": "-5.00"}], "pending": []}}),
], ids=[
    "non-json", "empty-body", "json-array", "json-string", "json-null", "transactions-array",
    "transactions-null", "booked-and-pending-not-lists", "rows-not-objects", "amount-not-an-object",
])
def test_a_malformed_200_body_yields_no_rows_rather_than_raising(monkeypatch, response) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: response)
    assert pull_transactions(SOURCE, "access-token") == []


def test_malformed_rows_are_skipped_without_losing_the_well_formed_ones(monkeypatch) -> None:
    good = SANDBOX_RESPONSE["transactions"]["booked"][0]
    response = {"transactions": {"booked": ["junk", good, {"transactionAmount": None}], "pending": "junk"}}
    monkeypatch.setattr(httpx, "get", lambda url, headers=None, timeout=None: httpx.Response(200, json=response))

    assert [row.id for row in pull_transactions(SOURCE, "access-token")] == ["txn-1"]
