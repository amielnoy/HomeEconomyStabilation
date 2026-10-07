from __future__ import annotations

import re

import httpx
from pydantic import ValidationError

from .models import Transaction
from .open_banking_config import OpenBankingSource

_REDACTED = "[redacted]"
_FINANCIAL_IDENTIFIERS = (
    re.compile(r"\b(?:IBAN\s*)?[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b", re.IGNORECASE),
    re.compile(r"\b(?:cvv|cvc|security\s*code)\s*[:#-]?\s*\d{3,4}\b", re.IGNORECASE),
    re.compile(r"\b(?:\d[ -]?){12,18}\d\b"),
    re.compile(r"\b\d{1,3}[- ]\d{1,4}[- ]\d{4,10}\b"),
    re.compile(
        r"\b(?:חשבון|חשבונות|בנק|סניף|כרטיס|account|acct|branch|card|מספר|no|nr)[\s:.#-]*"
        r"\d[\d-]{3,12}\d\b(?![.,]\d)",
        re.IGNORECASE,
    ),
)


def _redact(value: str) -> str:
    for pattern in _FINANCIAL_IDENTIFIERS:
        value = pattern.sub(_REDACTED, value)
    return value


def _to_row(raw: dict, *, pending: bool) -> Transaction | None:
    amount = raw.get("transactionAmount", {})
    try:
        signed = float(amount.get("amount", ""))
    except (TypeError, ValueError):
        return None
    desc = _redact(str(raw.get("remittanceInformationUnstructured", "")))
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
            "source": "bank",
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
    body = response.json()
    transactions = body.get("transactions", {})
    rows = []
    for raw in transactions.get("booked", []):
        row = _to_row(raw, pending=False)
        if row:
            rows.append(row)
    for raw in transactions.get("pending", []):
        row = _to_row(raw, pending=True)
        if row:
            rows.append(row)
    return rows
