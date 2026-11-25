"""Identity tables: organizations (the tenants), users, memberships and sessions.

A user is a global identity. What they can do comes from a membership, which ties the user
to one organization with one role. A person can belong to several organizations.
"""

import uuid
from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from buildingops.core.models import Base, IdMixin, TenantMixin, TimestampMixin
from buildingops.core.permissions import Role


class OrganizationStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class MembershipStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class Organization(IdMixin, TimestampMixin, Base):
    __tablename__ = "organizations"
    __table_args__ = (
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_iso4217"),
        CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug_format"),
    )

    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    legal_name: Mapped[str | None] = mapped_column(String(200))
    timezone: Mapped[str] = mapped_column(String(64), default="America/New_York")
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    status: Mapped[OrganizationStatus] = mapped_column(default=OrganizationStatus.ACTIVE)


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(CITEXT, unique=True)
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True, server_default=sa.true())
    is_platform_admin: Mapped[bool] = mapped_column(default=False, server_default=sa.false())
    last_login_at: Mapped[datetime | None]


class Membership(IdMixin, TimestampMixin, TenantMixin, Base):
    __tablename__ = "memberships"
    __table_args__ = (
        UniqueConstraint("organization_id", "user_id"),
        CheckConstraint("role <> 'platform_admin'", name="role_assignable"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    role: Mapped[Role]
    status: Mapped[MembershipStatus] = mapped_column(default=MembershipStatus.ACTIVE)
    title: Mapped[str | None] = mapped_column(String(120))


class AuthSession(IdMixin, Base):
    """A signed-in session. The bearer token is stored only as a SHA-256 hash."""

    __tablename__ = "auth_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    active_organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]
    ip: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(String(400))


class LoginAttempt(IdMixin, Base):
    """Sign-in attempts, kept for throttling and for investigating account attacks."""

    __tablename__ = "login_attempts"
    __table_args__ = (
        Index("ix_login_attempts_email_created_at", "email", "created_at"),
        Index("ix_login_attempts_ip_created_at", "ip", "created_at"),
    )

    email: Mapped[str] = mapped_column(CITEXT)
    ip: Mapped[str | None] = mapped_column(String(45))
    succeeded: Mapped[bool]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
