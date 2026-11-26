"""Base classes and field types for API request and response models."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Any, Self

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
)


class RequestModel(BaseModel):
    """Input from a client. Unknown fields are rejected rather than silently dropped."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ResponseModel(BaseModel):
    """Output to a client, usually built from an ORM object."""

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_record(cls, record: object, **computed: Any) -> Self:
        """Build from a row plus the values it does not carry: counts, embedded records,
        or a field the caller is not allowed to see."""
        values = {name: getattr(record, name) for name in cls.model_fields if name not in computed}
        return cls(**values, **computed)


# --- field types shared by request models ----------------------------------------------


def _blank_as_none(value: object) -> object:
    if isinstance(value, str) and not value.strip():
        return None
    return value


def _country_code(value: str) -> str:
    if not (value.isascii() and value.isalpha()):
        raise ValueError("Use a two-letter country code such as US.")
    return value


def two_decimal_places(value: Decimal) -> Decimal:
    """Amounts read the same going in and coming out: 18.5 is stored and returned as 18.50."""
    return value.quantize(Decimal("0.01"))


def _in_utc(value: datetime) -> datetime:
    return value.astimezone(UTC)


# A form sends "" for an input left empty. On an optional field that means "no value", and
# it is stored as NULL so that "has a value" stays a simple question to ask of the data.
BlankAsNone = BeforeValidator(_blank_as_none)

# Text sized to its column.
Text100 = Annotated[str, StringConstraints(min_length=1, max_length=100)]
Text200 = Annotated[str, StringConstraints(min_length=1, max_length=200)]
OptionalText20 = Annotated[Annotated[str, StringConstraints(max_length=20)] | None, BlankAsNone]
OptionalText40 = Annotated[Annotated[str, StringConstraints(max_length=40)] | None, BlankAsNone]
OptionalText100 = Annotated[Annotated[str, StringConstraints(max_length=100)] | None, BlankAsNone]
OptionalText200 = Annotated[Annotated[str, StringConstraints(max_length=200)] | None, BlankAsNone]
# The column is unbounded; the limit keeps a note a note.
Notes = Annotated[Annotated[str, StringConstraints(max_length=5000)] | None, BlankAsNone]
OptionalEmail = Annotated[EmailStr | None, BlankAsNone]

# Codes people type and quote to each other. Upper case, so "bld-7" and "BLD-7" cannot both
# exist in one organization.
Code = Annotated[str, StringConstraints(min_length=1, max_length=20, to_upper=True)]
OptionalCode = Annotated[Code | None, BlankAsNone]
# The shape of an ISO 3166-1 alpha-2 code: two letters. Not checked against the list.
CountryCode = Annotated[
    str,
    StringConstraints(min_length=2, max_length=2, to_upper=True),
    AfterValidator(_country_code),
]
PaymentTermsDays = Annotated[int, Field(ge=0, le=180)]
# A point in time. It has to say which zone it is in, and is kept in UTC, which is how the
# database returns it: a record reads the same when it is saved as when it is read back.
Moment = Annotated[AwareDatetime, AfterValidator(_in_utc)]
