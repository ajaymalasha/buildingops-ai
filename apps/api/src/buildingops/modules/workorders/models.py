"""Work orders: jobs to be done at a building, and the history of each one."""

import uuid
from datetime import date, datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from buildingops.core.models import Base, IdMixin, TenantMixin, TimestampMixin, tenant_fk


class WorkOrderCategory(StrEnum):
    CLEANING = "cleaning"
    MAINTENANCE = "maintenance"
    REPAIR = "repair"
    INSPECTION = "inspection"
    HVAC = "hvac"
    ELECTRICAL = "electrical"
    PLUMBING = "plumbing"
    LANDSCAPING = "landscaping"
    SECURITY = "security"
    OTHER = "other"


class WorkOrderPriority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class WorkOrderStatus(StrEnum):
    OPEN = "open"
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    ON_HOLD = "on_hold"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class WorkOrderSource(StrEnum):
    INTERNAL = "internal"
    CUSTOMER_REQUEST = "customer_request"
    INSPECTION = "inspection"
    PREVENTIVE = "preventive"


class WorkOrderActivityKind(StrEnum):
    COMMENT = "comment"
    STATUS_CHANGE = "status_change"
    ASSIGNMENT = "assignment"


class WorkOrder(IdMixin, TimestampMixin, TenantMixin, Base):
    """Not archivable: a work order ends by status, as completed or cancelled."""

    __tablename__ = "work_orders"
    __table_args__ = (
        tenant_fk("building_id", "buildings"),
        tenant_fk("contract_id", "contracts"),
        tenant_fk("assigned_employee_id", "employees"),
        tenant_fk("vendor_id", "vendors"),
        UniqueConstraint("organization_id", "number"),
        Index("ix_work_orders_organization_id_status", "organization_id", "status"),
        Index("ix_work_orders_organization_id_building_id", "organization_id", "building_id"),
        Index(
            "ix_work_orders_organization_id_assigned_employee_id",
            "organization_id",
            "assigned_employee_id",
        ),
        Index("ix_work_orders_organization_id_due_on", "organization_id", "due_on"),
        CheckConstraint("completed_at >= started_at", name="completed_not_before_started"),
    )

    number: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    building_id: Mapped[uuid.UUID]
    contract_id: Mapped[uuid.UUID | None]
    category: Mapped[WorkOrderCategory]
    priority: Mapped[WorkOrderPriority] = mapped_column(default=WorkOrderPriority.NORMAL)
    status: Mapped[WorkOrderStatus] = mapped_column(default=WorkOrderStatus.OPEN)
    source: Mapped[WorkOrderSource] = mapped_column(default=WorkOrderSource.INTERNAL)
    assigned_employee_id: Mapped[uuid.UUID | None]
    vendor_id: Mapped[uuid.UUID | None]
    requested_by: Mapped[str | None] = mapped_column(String(200))
    due_on: Mapped[date | None]
    scheduled_for: Mapped[datetime | None]
    started_at: Mapped[datetime | None]
    completed_at: Mapped[datetime | None]
    billable: Mapped[bool] = mapped_column(default=True, server_default=sa.true())


class WorkOrderActivity(IdMixin, TimestampMixin, TenantMixin, Base):
    """One entry in a work order's history: a comment, a status change or a reassignment.

    Entries are only ever added. The author's name is copied in, so an entry still reads
    correctly after a rename, and `author_user_id` is empty for history that no signed-in
    person wrote.
    """

    __tablename__ = "work_order_activities"
    __table_args__ = (
        tenant_fk(
            "work_order_id",
            "work_orders",
            ondelete="CASCADE",
            name="fk_work_order_activities_work_order_id_work_orders",
        ),
        Index("ix_work_order_activities_work_order_id_created_at", "work_order_id", "created_at"),
    )

    work_order_id: Mapped[uuid.UUID]
    kind: Mapped[WorkOrderActivityKind]
    body: Mapped[str | None] = mapped_column(Text)
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str | None] = mapped_column(String(20))
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    author_name: Mapped[str] = mapped_column(String(200))
