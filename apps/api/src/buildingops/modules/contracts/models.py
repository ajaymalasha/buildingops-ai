"""Contracts: the commercial terms under which a customer's buildings are serviced."""

import uuid
from datetime import date
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import CheckConstraint, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from buildingops.core.models import Base, IdMixin, TenantMixin, TimestampMixin, tenant_fk


class ContractStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    EXPIRED = "expired"
    TERMINATED = "terminated"


class BillingModel(StrEnum):
    COST_PLUS = "cost_plus"
    FIXED_FEE = "fixed_fee"
    TIME_AND_MATERIALS = "time_and_materials"


class Contract(IdMixin, TimestampMixin, TenantMixin, Base):
    """Not archivable: a contract ends by status, and stays on record."""

    __tablename__ = "contracts"
    __table_args__ = (
        tenant_fk("customer_id", "customers"),
        UniqueConstraint("organization_id", "contract_number"),
        CheckConstraint("end_date >= start_date", name="end_not_before_start"),
        CheckConstraint("markup_percent BETWEEN 0 AND 500", name="markup_percent_range"),
        CheckConstraint("monthly_fee >= 0", name="monthly_fee_not_negative"),
        CheckConstraint("payment_terms_days BETWEEN 0 AND 180", name="payment_terms_days_range"),
        # Each billing model needs the figure it bills from.
        CheckConstraint(
            "billing_model <> 'cost_plus' OR markup_percent IS NOT NULL",
            name="cost_plus_has_markup",
        ),
        CheckConstraint(
            "billing_model <> 'fixed_fee' OR monthly_fee IS NOT NULL",
            name="fixed_fee_has_monthly_fee",
        ),
    )

    customer_id: Mapped[uuid.UUID]
    contract_number: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[ContractStatus] = mapped_column(default=ContractStatus.DRAFT)
    billing_model: Mapped[BillingModel]
    start_date: Mapped[date]
    end_date: Mapped[date | None]
    markup_percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    monthly_fee: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))
    payment_terms_days: Mapped[int] = mapped_column(default=30)
    notes: Mapped[str | None] = mapped_column(Text)


class ContractBuilding(IdMixin, TimestampMixin, TenantMixin, Base):
    """A building covered by a contract."""

    __tablename__ = "contract_buildings"
    __table_args__ = (
        tenant_fk("contract_id", "contracts", ondelete="CASCADE"),
        tenant_fk("building_id", "buildings"),
        UniqueConstraint("contract_id", "building_id"),
    )

    contract_id: Mapped[uuid.UUID]
    building_id: Mapped[uuid.UUID]
