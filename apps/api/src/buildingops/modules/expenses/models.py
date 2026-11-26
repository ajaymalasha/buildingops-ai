"""Expenses: what was spent on materials, equipment, subcontractors and the like."""

import uuid
from datetime import date
from decimal import Decimal
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, Index, Numeric, String
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


class ExpenseCategory(StrEnum):
    MATERIALS = "materials"
    EQUIPMENT = "equipment"
    SUBCONTRACTOR = "subcontractor"
    SUPPLIES = "supplies"
    TRAVEL = "travel"
    OTHER = "other"


class Expense(IdMixin, TimestampMixin, DecisionMixin, TenantMixin, Base):
    """A cost, optionally tied to the building, contract, vendor or work order it was for."""

    __tablename__ = "expenses"
    __table_args__ = (
        tenant_fk("building_id", "buildings"),
        tenant_fk("contract_id", "contracts"),
        tenant_fk("vendor_id", "vendors"),
        tenant_fk("work_order_id", "work_orders"),
        Index(
            "ix_expenses_organization_id_status_incurred_on",
            "organization_id",
            "status",
            "incurred_on",
        ),
        Index(
            "ix_expenses_organization_id_contract_id_incurred_on",
            "organization_id",
            "contract_id",
            "incurred_on",
        ),
        CheckConstraint("amount > 0", name="amount_positive"),
        decided_unless_pending(),
    )

    category: Mapped[ExpenseCategory]
    description: Mapped[str] = mapped_column(String(300))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))
    incurred_on: Mapped[date]
    building_id: Mapped[uuid.UUID | None]
    contract_id: Mapped[uuid.UUID | None]
    vendor_id: Mapped[uuid.UUID | None]
    work_order_id: Mapped[uuid.UUID | None]
    billable: Mapped[bool] = mapped_column(default=True, server_default=sa.true())
    reference: Mapped[str | None] = mapped_column(String(100))
