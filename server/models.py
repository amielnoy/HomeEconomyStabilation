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
    # Mirrors redactFinancialIdentifiers in src/privacy.ts: a digit run introduced by
    # an account, branch or card word is an identifier, not an amount. Python's \b is
    # Unicode-aware, so it works beside Hebrew where the JS equivalent needs lookarounds.
    re.compile(
        r"\b(?:חשבון|חשבונות|בנק|סניף|כרטיס|account|acct|branch|card|מספר|no|nr)[\s:.#-]*"
        r"\d[\d-]{3,12}\d\b(?![.,]\d)",
        re.IGNORECASE,
    ),
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
    # Who issues the card, which is what decides whether its detail cancels the statement's
    # aggregate charge. Absent on rows imported before the distinction existed.
    cardKind: Literal["bank", "external"] | None = None
    # Which company issued the card, as the customer answered it at import. Provenance
    # shown on the row; it decides nothing about categorisation or reconciliation.
    cardBrand: Literal[
        "visa", "cal", "isracard", "diners", "amex", "max", "leumi", "other"
    ] | None = None
    src: SnapshotSource
    id: str | None = Field(default=None, max_length=200)
    cat: str | None = Field(default=None, max_length=100)
    kind: CategoryKind | None = None

    # What the household calls this card, typed at import. Two Visas are two cards and no
    # export says which is which; a name the customer chose is the only thing that tells
    # them apart without keeping a card number, which this boundary refuses outright.
    cardName: str | None = Field(default=None, max_length=40)

    @field_validator("cardName")
    @classmethod
    def card_name_has_no_financial_identifier(cls, value: str | None) -> str | None:
        if value is not None and _contains_financial_identifier(value):
            raise ValueError("financial identifier is not allowed")
        return value

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
    # Which direction the rule reads, for wording that means opposite things on the two
    # sides of a statement: an allowance arriving under the same name a contribution
    # leaves under. Absent on every rule that reads both ways, which is nearly all of them.
    when: Literal["in", "out"] | None = None


class Category(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(max_length=100)
    name: str = Field(max_length=200)
    kind: CategoryKind


class SavingsGoal(BaseModel):
    """What a household is saving towards, in figures it entered itself.

    The name is free text the customer typed, so it passes the same identifier check a
    description does: nobody means to write an account number into a goal, and the one who
    does should not have it kept.
    """

    model_config = ConfigDict(extra="forbid")
    id: str = Field(max_length=100)
    name: str = Field(max_length=200)
    target: float = Field(ge=0, le=1_000_000_000)
    saved: float = Field(ge=0, le=1_000_000_000)
    due: str | None = Field(default=None, max_length=7, pattern=r"^\d{4}-\d{2}$")

    @field_validator("name")
    @classmethod
    def name_has_no_financial_identifier(cls, value: str) -> str:
        if _contains_financial_identifier(value):
            raise ValueError("financial identifier is not allowed")
        return value


class CloudStatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tx: list[Transaction] = Field(max_length=50_000)
    overrides: dict[str, str]
    rules: list[CategoryRule] = Field(max_length=1_000)
    cats: list[Category] = Field(max_length=1_000)
    budgets: dict[str, float]
    goals: list[SavingsGoal] = Field(default_factory=list, max_length=100)

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


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    preferred_locale: Locale = Field(alias="preferredLocale")


class CloudConsentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    locale: Locale


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
