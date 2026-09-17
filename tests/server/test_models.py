import pytest
from pydantic import ValidationError

from server.models import CategoryRule, SnapshotInput, Transaction


def valid_snapshot() -> dict[str, object]:
    return {
        "schemaVersion": 2,
        "payload": {"tx": [], "overrides": {}, "rules": [], "cats": [], "budgets": {}},
    }


def test_snapshot_model_accepts_the_minimal_privacy_safe_shape() -> None:
    assert SnapshotInput.model_validate(valid_snapshot()).payload.persistence_dict()["tx"] == []


@pytest.mark.parametrize("transaction", [
    {
        "date": "2026-08-24", "vdate": "2026-08-24", "ref": "", "desc": "Shop",
        "out": 10, "in": 0, "bal": None, "pending": False, "src": "bank-report",
        "cardNumber": "4111111111111111",
    },
    {
        "date": "2026-08-24", "vdate": "2026-08-24", "ref": "", "desc": "card 4111111111111111",
        "out": 10, "in": 0, "bal": None, "pending": False, "src": "bank-report",
    },
])
def test_snapshot_model_rejects_unknown_or_sensitive_transaction_fields(transaction: dict[str, object]) -> None:
    candidate = valid_snapshot()
    candidate["payload"]["tx"] = [transaction]  # type: ignore[index]
    with pytest.raises(ValidationError):
        SnapshotInput.model_validate(candidate)


def test_transaction_accepts_the_card_issuer() -> None:
    """The browser decides who issues a card and the snapshot has to carry that answer."""
    payload = {
        "date": "2026-08-03", "vdate": "2026-08-03", "ref": "", "desc": "shop",
        "out": 431.0, "in": 0.0, "bal": None, "pending": False,
        "source": "card", "cardKind": "external", "src": "card-report",
    }

    assert Transaction.model_validate(payload).cardKind == "external"


def test_transaction_rejects_an_unknown_card_issuer() -> None:
    payload = {
        "date": "2026-08-03", "vdate": "2026-08-03", "ref": "", "desc": "shop",
        "out": 431.0, "in": 0.0, "bal": None, "pending": False,
        "source": "card", "cardKind": "amex", "src": "card-report",
    }

    with pytest.raises(ValidationError):
        Transaction.model_validate(payload)



def test_rule_accepts_the_direction_it_reads() -> None:
    """The browser stores a direction on rules whose wording means opposite things on the
    two sides of a statement. This model forbids extra keys, so a field it does not know
    does not lose the field — it rejects the whole snapshot and the customer syncs nothing.
    """
    rule = {"id": "r1", "match": "ביטוח לאומי", "cat": "income", "when": "in"}

    assert CategoryRule.model_validate(rule).when == "in"


def test_rule_without_a_direction_still_validates() -> None:
    """Nearly every rule reads both ways and carries no direction at all."""
    assert CategoryRule.model_validate({"id": "r2", "match": "שופרסל", "cat": "food"}).when is None


def test_rule_rejects_a_direction_that_is_not_a_side_of_a_statement() -> None:
    with pytest.raises(ValidationError):
        CategoryRule.model_validate({"id": "r3", "match": "x", "cat": "food", "when": "sideways"})


def test_snapshot_carries_a_directional_rule_end_to_end() -> None:
    """The default rules ship with one, so this is the ordinary path, not an edge case."""
    candidate = valid_snapshot()
    candidate["payload"]["rules"] = [  # type: ignore[index]
        {"id": "r1", "match": "ביטוח לאומי", "cat": "income", "when": "in"},
    ]

    assert SnapshotInput.model_validate(candidate).payload.persistence_dict()["rules"][0]["when"] == "in"

