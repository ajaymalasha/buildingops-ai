"""The audit trail: an append-only record of who changed what."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from buildingops.core.models import Base, IdMixin


class AuditLog(IdMixin, Base):
    """One recorded action. Rows cannot be updated or deleted (enforced by triggers).

    `organization_id` is NULL for platform-level events that belong to no tenant. The actor's
    name and role are copied in, so the entry still reads correctly after a rename or a
    role change.
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_organization_created", "organization_id", "created_at"),
        Index("ix_audit_logs_entity", "organization_id", "entity_type", "entity_id"),
    )

    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    actor_name: Mapped[str] = mapped_column(String(200))
    actor_role: Mapped[str | None] = mapped_column(String(40))
    action: Mapped[str] = mapped_column(String(80))
    entity_type: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[uuid.UUID | None]
    summary: Mapped[str] = mapped_column(String(400))
    changes: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    request_id: Mapped[str | None] = mapped_column(String(64))
    ip: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
