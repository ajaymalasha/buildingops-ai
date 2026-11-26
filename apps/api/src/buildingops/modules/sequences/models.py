"""Per-organization counters behind human-readable codes such as CUS-0001."""

from sqlalchemy import CheckConstraint, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from buildingops.core.models import Base, IdMixin, TenantMixin, TimestampMixin


class OrganizationSequence(IdMixin, TimestampMixin, TenantMixin, Base):
    """One counter per organization and name. `next_value` is the number not yet given out."""

    __tablename__ = "organization_sequences"
    __table_args__ = (
        UniqueConstraint("organization_id", "name"),
        CheckConstraint("next_value > 0", name="next_value_positive"),
    )

    name: Mapped[str] = mapped_column(String(40))
    next_value: Mapped[int] = mapped_column(default=1)
