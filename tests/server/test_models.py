import pytest
from pydantic import ValidationError

from server.models import SnapshotInput


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
