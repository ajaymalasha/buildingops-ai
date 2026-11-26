"""Vendors: subcontractors and suppliers an organization buys services and goods from."""

from datetime import date
from enum import StrEnum

from sqlalchemy import CheckConstraint, Index, String, Text, text
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from buildingops.core.models import Base, IdMixin, SoftDeleteMixin, TenantMixin, TimestampMixin


class VendorCategory(StrEnum):
    JANITORIAL = "janitorial"
    HVAC = "hvac"
    ELECTRICAL = "electrical"
    PLUMBING = "plumbing"
    LANDSCAPING = "landscaping"
    SECURITY = "security"
    ELEVATOR = "elevator"
    PEST_CONTROL = "pest_control"
    WASTE = "waste"
    SUPPLIES = "supplies"
    OTHER = "other"


class VendorStatus(StrEnum):
    PENDING_COMPLIANCE = "pending_compliance"
    ACTIVE = "active"
    INACTIVE = "inactive"


class Vendor(IdMixin, TimestampMixin, SoftDeleteMixin, TenantMixin, Base):
    __tablename__ = "vendors"
    __table_args__ = (
        Index(
            "uq_vendors_organization_id_code",
            "organization_id",
            "code",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        CheckConstraint("payment_terms_days BETWEEN 0 AND 180", name="payment_terms_days_range"),
    )

    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(20))
    category: Mapped[VendorCategory]
    status: Mapped[VendorStatus] = mapped_column(default=VendorStatus.ACTIVE)
    contact_name: Mapped[str | None] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(CITEXT)
    phone: Mapped[str | None] = mapped_column(String(40))
    address_line1: Mapped[str | None] = mapped_column(String(200))
    address_line2: Mapped[str | None] = mapped_column(String(200))
    city: Mapped[str | None] = mapped_column(String(100))
    region: Mapped[str | None] = mapped_column(String(100))
    postal_code: Mapped[str | None] = mapped_column(String(20))
    country: Mapped[str] = mapped_column(String(2), default="US")
    insurance_expires_on: Mapped[date | None]
    payment_terms_days: Mapped[int] = mapped_column(default=30)
    notes: Mapped[str | None] = mapped_column(Text)
