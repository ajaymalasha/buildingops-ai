"""Declarative base, shared column mixins and schema conventions."""

import enum
import uuid
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    MetaData,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Deterministic constraint names, so migrations can refer to them and errors are readable.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_N_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def new_id() -> uuid.UUID:
    """UUIDv7: time-ordered, so primary-key indexes stay compact, and safe to expose."""
    return uuid.uuid7()


def utcnow() -> datetime:
    return datetime.now(UTC)


def _enum_values(enum_class: type[enum.Enum]) -> list[str]:
    return [str(member.value) for member in enum_class]


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {  # noqa: RUF012 - SQLAlchemy reads this as class configuration
        datetime: DateTime(timezone=True),
        # Enums are stored as their string values in a VARCHAR with a CHECK constraint.
        # Adding a value is then an ordinary constraint change rather than ALTER TYPE.
        enum.Enum: sa.Enum(
            enum.Enum,
            native_enum=False,
            create_constraint=True,
            length=40,
            values_callable=_enum_values,
            validate_strings=True,
        ),
    }


class IdMixin:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_id, sort_order=-100)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), sort_order=100)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), sort_order=101
    )


class SoftDeleteMixin:
    """Archived rows stay for history and references, and are hidden from normal lists."""

    deleted_at: Mapped[datetime | None] = mapped_column(default=None, sort_order=102)

    @property
    def is_archived(self) -> bool:
        return self.deleted_at is not None


class TenantMixin:
    """A row owned by one organization.

    Adds `organization_id` and a unique `(organization_id, id)` pair. Other tenant tables
    reference that pair through `tenant_fk`, which makes a cross-organization reference
    impossible at the database level, not only in application code. The same index serves
    lookups by organization.
    """

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT"), sort_order=-90
    )

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        table = cls.__dict__.get("__table__")
        if table is not None:
            table.append_constraint(UniqueConstraint("organization_id", "id"))


def tenant_fk(
    column: str, target_table: str, *, ondelete: str = "RESTRICT", name: str | None = None
) -> ForeignKeyConstraint:
    """Composite foreign key `(organization_id, <column>)` to another tenant table.

    Give it a `name` only when the conventional one would be longer than the 63
    characters PostgreSQL keeps of an identifier.
    """
    return ForeignKeyConstraint(
        ["organization_id", column],
        [f"{target_table}.organization_id", f"{target_table}.id"],
        ondelete=ondelete,
        name=name,
    )


class DecisionStatus(enum.StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class DecisionMixin:
    """A row that is entered as pending and then approved or rejected by a person.

    The name of whoever decided is copied in, as the actor's is in the audit log, so the
    row still reads correctly after a rename. `core/decisions.py` makes the moves, and
    `decided_unless_pending` belongs in the table's constraints.
    """

    status: Mapped[DecisionStatus] = mapped_column(default=DecisionStatus.PENDING, sort_order=50)
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), sort_order=51
    )
    decided_by_name: Mapped[str | None] = mapped_column(String(200), sort_order=52)
    decided_at: Mapped[datetime | None] = mapped_column(sort_order=53)
    rejection_reason: Mapped[str | None] = mapped_column(String(500), sort_order=54)


def decided_unless_pending() -> CheckConstraint:
    """A pending row carries no decision, and a decided one says when it was made."""
    return CheckConstraint(
        "(status = 'pending') = (decided_at IS NULL)", name="decided_unless_pending"
    )
