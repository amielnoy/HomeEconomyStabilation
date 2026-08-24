from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Locale = Literal["he", "en", "am", "fr"]
CategoryKind = Literal["expense", "income", "neutral"]
SnapshotSource = Literal["bank-report", "card-report", "manual-entry"]

_RESERVED_KEYS = {"__proto__", "prototype", "constructor"}
_FINANCIAL_IDENTIFIERS = (
    re.compile(r"\b(?:IBAN\s*)?[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b", re.IGNORECASE),
    re.compile(r"\b(?:cvv|cvc|security\s*code)\s*[:#-]?\s*\d{3,4}\b", re.IGNORECASE),
    re.compile(r"\b(?:\d[ -]?){12,18}\d\b"),
    re.compile(r"\b\d{1,3}[- ]\d{1,4}[- ]\d{4,10}\b"),
)


def _contains_financial_identifier(value: str) -> bool:
    return any(pattern.search(value) for pattern in _FINANCIAL_IDENTIFIERS)


class Transaction(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    date: str = Field(max_length=32)
    vdate: str = Field(max_length=32)
    ref: Literal[""]
    desc: str = Field(max_length=500)
    out: float = Field(ge=0, le=1_000_000_000)
    incoming: float = Field(alias="in", ge=0, le=1_000_000_000)
    bal: float | None = Field(ge=-1_000_000_000, le=1_000_000_000)
    pending: bool
    source: Literal["bank", "card"] | None = None
    src: SnapshotSource
    id: str | None = Field(default=None, max_length=200)
    cat: str | None = Field(default=None, max_length=100)
    kind: CategoryKind | None = None

    @field_validator("desc")
    @classmethod
    def description_has_no_financial_identifier(cls, value: str) -> str:
        if _contains_financial_identifier(value):
            raise ValueError("financial identifier is not allowed")
        return value


class CategoryRule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(max_length=100)
    match: str = Field(max_length=200)
    cat: str = Field(max_length=100)


class Category(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(max_length=100)
    name: str = Field(max_length=200)
    kind: CategoryKind


class CloudStatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tx: list[Transaction] = Field(max_length=50_000)
    overrides: dict[str, str]
    rules: list[CategoryRule] = Field(max_length=1_000)
    cats: list[Category] = Field(max_length=1_000)
    budgets: dict[str, float]

    @model_validator(mode="after")
    def validate_dictionaries(self) -> "CloudStatePayload":
        if len(self.overrides) > 50_000 or len(self.budgets) > 1_000:
            raise ValueError("dictionary is too large")
        for key, value in self.overrides.items():
            if key in _RESERVED_KEYS or len(key) > 200 or len(value) > 200:
                raise ValueError("invalid override")
        for key, value in self.budgets.items():
            if key in _RESERVED_KEYS or len(key) > 100 or not 0 <= value <= 1_000_000_000:
                raise ValueError("invalid budget")
        return self

    def persistence_dict(self) -> dict[str, object]:
        return self.model_dump(by_alias=True, exclude_none=True)


class SnapshotInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: Literal[2]
    payload: CloudStatePayload


class UserProfile(BaseModel):
    user_id: str
    preferred_locale: Locale
    created_at: datetime
    updated_at: datetime


class ConsentAcceptance(BaseModel):
    user_id: str
    purpose: Literal["cloud_sync"]
    statement_version: str = Field(max_length=80)
    locale: Locale
    accepted_at: datetime
    withdrawn_at: datetime | None
