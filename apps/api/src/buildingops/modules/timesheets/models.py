"""Timesheets: the hours an employee worked at a building on one day, and what they cost."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import CheckConstraint, Index, Numeric, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from buildingops.core.models import (
    Base,
    DecisionMixin,
    IdMixin,
    TenantMixin,
    TimestampMixin,
    decided_unless_pending,
    tenant_fk,
)


class TimesheetSource(StrEnum):
    MANUAL = "manual"
    SCHEDULE = "schedule"
    VOICE = "voice"
    IMPORT = "import"


class Timesheet(IdMixin, TimestampMixin, DecisionMixin, TenantMixin, Base):
    """One row per employee, work date and building.

    `hourly_rate` is the employee's rate on the day the time was entered, so a later raise
    does not rewrite what past work cost. `labor_cost` is worked out from the hours and
    that rate by `costing.labor_cost` on every write.
    """

    __tablename__ = "timesheets"
    __table_args__ = (
        tenant_fk("employee_id", "employees"),
        tenant_fk("building_id", "buildings"),
        tenant_fk("contract_id", "contracts"),
        tenant_fk("shift_id", "shifts"),
        UniqueConstraint("employee_id", "work_date", "building_id"),
        Index(
            "ix_timesheets_organization_id_status_work_date",
            "organization_id",
            "status",
            "work_date",
        ),
        Index(
            "ix_timesheets_organization_id_building_id_work_date",
            "organization_id",
            "building_id",
            "work_date",
        ),
        Index(
            "ix_timesheets_organization_id_contract_id_work_date",
            "organization_id",
            "contract_id",
            "work_date",
        ),
        CheckConstraint("hours_regular BETWEEN 0 AND 24", name="hours_regular_range"),
        CheckConstraint("hours_overtime BETWEEN 0 AND 24", name="hours_overtime_range"),
        CheckConstraint(
            "hours_regular + hours_overtime > 0 AND hours_regular + hours_overtime <= 24",
            name="total_hours_range",
        ),
        CheckConstraint("hourly_rate >= 0", name="hourly_rate_not_negative"),
        CheckConstraint("overtime_multiplier BETWEEN 1 AND 3", name="overtime_multiplier_range"),
        CheckConstraint("labor_cost >= 0", name="labor_cost_not_negative"),
        decided_unless_pending(),
    )

    employee_id: Mapped[uuid.UUID]
    building_id: Mapped[uuid.UUID]
    contract_id: Mapped[uuid.UUID | None]
    shift_id: Mapped[uuid.UUID | None]
    work_date: Mapped[date]
    hours_regular: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    hours_overtime: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    hourly_rate: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    overtime_multiplier: Mapped[Decimal] = mapped_column(Numeric(3, 2), default=Decimal("1.50"))
    labor_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    source: Mapped[TimesheetSource] = mapped_column(default=TimesheetSource.MANUAL)
    notes: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime] = mapped_column(server_default=func.now())
