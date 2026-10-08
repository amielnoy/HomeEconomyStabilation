from __future__ import annotations

import httpx
from pydantic import ValidationError

from .models import FINANCIAL_IDENTIFIER_PATTERNS, Transaction
from .open_banking_config import OpenBankingSource

_REDACTED = "[redacted]"


def _redact(value: str) -> str:
    for pattern in FINANCIAL_IDENTIFIER_PATTERNS:
        value = pattern.sub(_REDACTED, value)
    return value


def _to_row(raw: dict, *, pending: bool, source: OpenBankingSource) -> Transaction | None:
    amount = raw.get("transactionAmount")
    if not isinstance(amount, dict):
        return None
    try:
        signed = float(amount.get("amount", ""))
    except (TypeError, ValueError):
        return None
    desc = _redact(str(raw.get("remittanceInformationUnstructured", "")))
    # Map source.kind to Transaction.source: "bank" -> "bank", "card_issuer" -> "card"
    source_map = {"bank": "bank", "card_issuer": "card"}
    transaction_source = source_map.get(source.kind, "bank")
    try:
        return Transaction.model_validate({
            "date": raw.get("bookingDate", ""),
            "vdate": raw.get("valueDate", raw.get("bookingDate", "")),
            "ref": "",
            "desc": desc,
            "out": max(0.0, -signed),
            "in": max(0.0, signed),
            "bal": None,
            "pending": pending,
            "source": transaction_source,
            "src": "open-banking",
            "id": raw.get("transactionId"),
        })
    except ValidationError:
        return None


def pull_transactions(source: OpenBankingSource, access_token: str) -> list[Transaction]:
    try:
        response = httpx.get(
            f"{source.base_url}/accounts/transactions",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10.0,
        )
    except httpx.HTTPError:
        return []
    if response.status_code != 200:
        return []
    # Guarded the same way open_banking_flow's token response is: a 200 whose body is not
    # JSON, or is JSON of the wrong shape, fails closed to "no rows" rather than raising.
    try:
        body = response.json()
    except ValueError:
        return []
    if not isinstance(body, dict):
        return []
    transactions = body.get("transactions")
    if not isinstance(transactions, dict):
        return []
    rows = []
    for key, pending in (("booked", False), ("pending", True)):
        entries = transactions.get(key)
        if not isinstance(entries, list):
            continue
        for raw in entries:
            if not isinstance(raw, dict):
                continue
            row = _to_row(raw, pending=pending, source=source)
            if row:
                rows.append(row)
    return rows
