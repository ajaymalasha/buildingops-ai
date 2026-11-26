"""The workforce: job roles, employees and the buildings they are assigned to.

An employee is a person the organization employs, whether or not they can sign in. A
membership is a login. `Employee.membership_id` ties the two together when the person has
both.
"""

import uuid
from datetime import date
from decimal import Decimal
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, Index, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from buildingops.core.models import (
    Base,
    IdMixin,
    SoftDeleteMixin,
    TenantMixin,
    TimestampMixin,
    tenant_fk,
)


class EmploymentType(StrEnum):
    FULL_TIME = "full_time"
    PART_TIME = "part_time"
    CONTRACTOR = "contractor"
    TEMPORARY = "temporary"


class EmployeeStatus(StrEnum):
    ONBOARDING = "onboarding"
    ACTIVE = "active"
    ON_LEAVE = "on_leave"
    TERMINATED = "terminated"


class JobRole(IdMixin, TimestampMixin, SoftDeleteMixin, TenantMixin, Base):
    __tablename__ = "job_roles"
    __table_args__ = (
        # Case-insensitive, so "Porter" and "porter" cannot both exist.
        Index(
            "uq_job_roles_organization_id_lower_name",
            "organization_id",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        CheckConstraint("default_hourly_rate >= 0", name="default_hourly_rate_not_negative"),
    )

    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    default_hourly_rate: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    is_supervisory: Mapped[bool] = mapped_column(default=False, server_default=sa.false())


class Employee(IdMixin, TimestampMixin, SoftDeleteMixin, TenantMixin, Base):
    __tablename__ = "employees"
    __table_args__ = (
        tenant_fk("job_role_id", "job_roles"),
        tenant_fk("supervisor_id", "employees"),
        tenant_fk("membership_id", "memberships"),
        Index(
            "uq_employees_organization_id_employee_number",
            "organization_id",
            "employee_number",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_employees_organization_id_email",
            "organization_id",
            "email",
            unique=True,
            postgresql_where=text("email IS NOT NULL AND deleted_at IS NULL"),
        ),
        # A login belongs to at most one employee record.
        Index(
            "uq_employees_membership_id",
            "membership_id",
            unique=True,
            postgresql_where=text("membership_id IS NOT NULL"),
        ),
        Index("ix_employees_organization_id_job_role_id", "organization_id", "job_role_id"),
        Index("ix_employees_organization_id_status", "organization_id", "status"),
        CheckConstraint("termination_date >= hire_date", name="termination_not_before_hire"),
        CheckConstraint("hourly_rate >= 0", name="hourly_rate_not_negative"),
        CheckConstraint("supervisor_id <> id", name="not_own_supervisor"),
    )

    employee_number: Mapped[str] = mapped_column(String(20))
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(CITEXT)
    phone: Mapped[str | None] = mapped_column(String(40))
    job_role_id: Mapped[uuid.UUID]
    supervisor_id: Mapped[uuid.UUID | None]
    membership_id: Mapped[uuid.UUID | None]
    employment_type: Mapped[EmploymentType]
    status: Mapped[EmployeeStatus] = mapped_column(default=EmployeeStatus.ACTIVE)
    hire_date: Mapped[date | None]
    termination_date: Mapped[date | None]
    hourly_rate: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    notes: Mapped[str | None] = mapped_column(Text)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


class BuildingAssignment(IdMixin, TimestampMixin, TenantMixin, Base):
    """An employee working at a building. Open until it is given an end date.

    Ended assignments are kept as history. Because the uniqueness rules cover open rows
    only, a person can return to a building they once left.
    """

    __tablename__ = "building_assignments"
    __table_args__ = (
        tenant_fk("employee_id", "employees"),
        tenant_fk("building_id", "buildings"),
        Index(
            "uq_building_assignments_employee_id_building_id_open",
            "employee_id",
            "building_id",
            unique=True,
            postgresql_where=text("ends_on IS NULL"),
        ),
        Index(
            "uq_building_assignments_employee_id_open_primary",
            "employee_id",
            unique=True,
            postgresql_where=text("is_primary AND ends_on IS NULL"),
        ),
        CheckConstraint("ends_on >= starts_on", name="ends_not_before_start"),
    )

    employee_id: Mapped[uuid.UUID]
    building_id: Mapped[uuid.UUID]
    is_primary: Mapped[bool] = mapped_column(default=False, server_default=sa.false())
    starts_on: Mapped[date]
    ends_on: Mapped[date | None]
