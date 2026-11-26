"""Buildings: the sites where work is done. Each belongs to one customer."""

import uuid
from enum import StrEnum

from sqlalchemy import CheckConstraint, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from buildingops.core.models import (
    Base,
    IdMixin,
    SoftDeleteMixin,
    TenantMixin,
    TimestampMixin,
    tenant_fk,
)


class BuildingType(StrEnum):
    OFFICE = "office"
    RETAIL = "retail"
    INDUSTRIAL = "industrial"
    MEDICAL = "medical"
    EDUCATION = "education"
    RESIDENTIAL = "residential"
    MIXED_USE = "mixed_use"
    OTHER = "other"


class BuildingStatus(StrEnum):
    ONBOARDING = "onboarding"
    ACTIVE = "active"
    INACTIVE = "inactive"


class Building(IdMixin, TimestampMixin, SoftDeleteMixin, TenantMixin, Base):
    __tablename__ = "buildings"
    __table_args__ = (
        tenant_fk("customer_id", "customers"),
        Index(
            "uq_buildings_organization_id_code",
            "organization_id",
            "code",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_buildings_organization_id_customer_id", "organization_id", "customer_id"),
        CheckConstraint("square_feet > 0", name="square_feet_positive"),
        CheckConstraint("floors > 0", name="floors_positive"),
    )

    customer_id: Mapped[uuid.UUID]
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(20))
    building_type: Mapped[BuildingType]
    status: Mapped[BuildingStatus] = mapped_column(default=BuildingStatus.ACTIVE)
    address_line1: Mapped[str] = mapped_column(String(200))
    address_line2: Mapped[str | None] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(100))
    region: Mapped[str | None] = mapped_column(String(100))
    postal_code: Mapped[str | None] = mapped_column(String(20))
    country: Mapped[str] = mapped_column(String(2), default="US")
    square_feet: Mapped[int | None]
    floors: Mapped[int | None]
    notes: Mapped[str | None] = mapped_column(Text)
