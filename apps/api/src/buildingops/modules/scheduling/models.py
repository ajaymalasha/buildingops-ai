"""Shifts: who is due to work at which building, and when."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, Index, Text, column, func, text
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column

from buildingops.core.models import Base, IdMixin, TenantMixin, TimestampMixin, tenant_fk

# Named here because the service reports a violation of it by name.
NO_OVERLAP_CONSTRAINT = "ex_shifts_employee_id_no_overlap"


class ShiftStatus(StrEnum):
    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    MISSED = "missed"
    CANCELLED = "cancelled"


class Shift(IdMixin, TimestampMixin, TenantMixin, Base):
    """Not archivable: a shift that will not happen is cancelled, and stays on record."""

    __tablename__ = "shifts"
    __table_args__ = (
        tenant_fk("employee_id", "employees"),
        tenant_fk("building_id", "buildings"),
        # One person cannot be in two places at once. The database guarantees it, so two
        # requests that each pass the service's check cannot both be saved. A range covers
        # its start and not its end, so one shift may begin the moment another ends.
        ExcludeConstraint(
            ("employee_id", "="),
            (func.tstzrange(column("starts_at"), column("ends_at")), "&&"),
            where=text("status <> 'cancelled'"),
            using="gist",
            name=NO_OVERLAP_CONSTRAINT,
        ),
        Index(
            "ix_shifts_organization_id_building_id_starts_at",
            "organization_id",
            "building_id",
            "starts_at",
        ),
        Index(
            "ix_shifts_organization_id_employee_id_starts_at",
            "organization_id",
            "employee_id",
            "starts_at",
        ),
        CheckConstraint("ends_at > starts_at", name="ends_after_start"),
        CheckConstraint("ends_at <= starts_at + interval '24 hours'", name="at_most_24_hours"),
        CheckConstraint("break_minutes BETWEEN 0 AND 240", name="break_minutes_range"),
    )

    employee_id: Mapped[uuid.UUID]
    building_id: Mapped[uuid.UUID]
    starts_at: Mapped[datetime]
    ends_at: Mapped[datetime]
    break_minutes: Mapped[int] = mapped_column(default=0)
    status: Mapped[ShiftStatus] = mapped_column(default=ShiftStatus.SCHEDULED)
    notes: Mapped[str | None] = mapped_column(Text)
