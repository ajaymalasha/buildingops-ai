"""Customers: the companies an organization provides building services to."""

from enum import StrEnum

from sqlalchemy import CheckConstraint, Index, String, Text, text
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from buildingops.core.models import Base, IdMixin, SoftDeleteMixin, TenantMixin, TimestampMixin


class CustomerStatus(StrEnum):
    PROSPECT = "prospect"
    ACTIVE = "active"
    INACTIVE = "inactive"


class Customer(IdMixin, TimestampMixin, SoftDeleteMixin, TenantMixin, Base):
    __tablename__ = "customers"
    __table_args__ = (
        # Among live rows only, so an archived customer does not hold its code forever.
        Index(
            "uq_customers_organization_id_code",
            "organization_id",
            "code",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        CheckConstraint("payment_terms_days BETWEEN 0 AND 180", name="payment_terms_days_range"),
    )

    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(20))
    status: Mapped[CustomerStatus] = mapped_column(default=CustomerStatus.ACTIVE)
    contact_name: Mapped[str | None] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(CITEXT)
    phone: Mapped[str | None] = mapped_column(String(40))
    address_line1: Mapped[str | None] = mapped_column(String(200))
    address_line2: Mapped[str | None] = mapped_column(String(200))
    city: Mapped[str | None] = mapped_column(String(100))
    region: Mapped[str | None] = mapped_column(String(100))
    postal_code: Mapped[str | None] = mapped_column(String(20))
    country: Mapped[str] = mapped_column(String(2), default="US")
    payment_terms_days: Mapped[int] = mapped_column(default=30)
    notes: Mapped[str | None] = mapped_column(Text)
