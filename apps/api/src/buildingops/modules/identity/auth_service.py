"""Sign-in, session verification and the signed-in user's own account actions.

Sessions are opaque bearer tokens checked against the `auth_sessions` table on every
request. That makes sign-out, suspension and organization changes take effect immediately,
with no token signing keys to manage and no refresh flow to get wrong. See
`docs/decisions/0002-authentication.md`.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from buildingops.core.config import Settings
from buildingops.core.context import Context, Principal, RequestMeta
from buildingops.core.db import DbContext, set_db_context
from buildingops.core.errors import (
    AuthenticationError,
    InvalidCredentialsError,
    NotFoundError,
    RateLimitedError,
    ValidationFailedError,
)
from buildingops.core.models import utcnow
from buildingops.core.permissions import Role, permissions_for
from buildingops.core.security import PasswordService, generate_session_token, hash_session_token
from buildingops.modules.audit import service as audit
from buildingops.modules.identity.models import (
    AuthSession,
    LoginAttempt,
    Membership,
    MembershipStatus,
    Organization,
    OrganizationStatus,
    User,
)
from buildingops.modules.identity.schemas import (
    MembershipSummary,
    MeRead,
    OrganizationRead,
    OrganizationSummary,
    UserRead,
)

# `last_seen_at` moves at most this often, so ordinary reads do not write on every request.
_LAST_SEEN_RESOLUTION = timedelta(minutes=5)


@dataclass(frozen=True, slots=True)
class LoginResult:
    token: str
    principal: Principal
    expires_at: datetime


class AuthService:
    def __init__(self, settings: Settings, passwords: PasswordService) -> None:
        self._passwords = passwords
        self._idle_timeout = timedelta(minutes=settings.session_idle_timeout_minutes)
        self._absolute_timeout = timedelta(minutes=settings.session_absolute_timeout_minutes)
        self._failure_window = timedelta(minutes=settings.login_failure_window_minutes)
        self._max_failures_per_email = settings.login_max_failures_per_email
        self._max_failures_per_ip = settings.login_max_failures_per_ip

    # --- sign-in ---------------------------------------------------------------------

    def login(self, db: Session, *, email: str, password: str, meta: RequestMeta) -> LoginResult:
        email = email.strip().lower()
        self._enforce_throttle(db, email=email, ip=meta.ip)

        user = db.scalar(select(User).where(User.email == email))
        password_ok = self._passwords.verify(user.password_hash if user else None, password)
        if user is None or not password_ok or not user.is_active:
            # Recorded in its own commit: the request fails, the attempt must still count.
            db.add(LoginAttempt(email=email, ip=meta.ip, succeeded=False, created_at=utcnow()))
            db.commit()
            raise InvalidCredentialsError()

        now = utcnow()
        token = generate_session_token()
        session = AuthSession(
            user_id=user.id,
            token_hash=hash_session_token(token),
            created_at=now,
            last_seen_at=now,
            expires_at=now + self._absolute_timeout,
            ip=meta.ip,
            user_agent=(meta.user_agent or "")[:400] or None,
        )
        db.add(session)
        db.add(LoginAttempt(email=email, ip=meta.ip, succeeded=True, created_at=now))
        user.last_login_at = now
        if user.password_hash and self._passwords.needs_rehash(user.password_hash):
            user.password_hash = self._passwords.hash(password)
        db.flush()

        principal = self._build_principal(db, user, session)
        return LoginResult(token=token, principal=principal, expires_at=self._expiry(session))

    def _enforce_throttle(self, db: Session, *, email: str, ip: str | None) -> None:
        now = utcnow()
        window_start = now - self._failure_window

        # Failures only count since the last successful sign-in for that email.
        last_success = db.scalar(
            select(func.max(LoginAttempt.created_at)).where(
                LoginAttempt.email == email, LoginAttempt.succeeded.is_(True)
            )
        )
        email_since = max(window_start, last_success) if last_success else window_start
        checks = [
            (LoginAttempt.email == email, email_since, self._max_failures_per_email),
        ]
        if ip:
            checks.append((LoginAttempt.ip == ip, window_start, self._max_failures_per_ip))

        for condition, since, limit in checks:
            count, oldest = db.execute(
                select(func.count(), func.min(LoginAttempt.created_at)).where(
                    condition,
                    LoginAttempt.succeeded.is_(False),
                    LoginAttempt.created_at > since,
                )
            ).one()
            if count >= limit:
                retry_after = int((oldest + self._failure_window - now).total_seconds())
                raise RateLimitedError(
                    "Too many failed sign-in attempts. Try again later.",
                    retry_after_seconds=max(retry_after, 1),
                )

    # --- per-request verification ----------------------------------------------------

    def authenticate(self, db: Session, token: str) -> Principal:
        row = db.execute(
            select(AuthSession, User)
            .join(User, User.id == AuthSession.user_id)
            .where(AuthSession.token_hash == hash_session_token(token))
        ).one_or_none()
        if row is None:
            raise AuthenticationError("The session is not valid. Sign in again.")
        session, user = row

        now = utcnow()
        if session.revoked_at is not None or self._expiry(session) <= now or not user.is_active:
            raise AuthenticationError("The session has ended. Sign in again.")

        if now - session.last_seen_at >= _LAST_SEEN_RESOLUTION:
            session.last_seen_at = now
        return self._build_principal(db, user, session)

    def _expiry(self, session: AuthSession) -> datetime:
        return min(session.expires_at, session.last_seen_at + self._idle_timeout)

    def _build_principal(self, db: Session, user: User, session: AuthSession) -> Principal:
        """Resolve the active organization and role, and point the database context at it."""
        # Memberships are row-level secured. The user can always read their own.
        set_db_context(db, DbContext(user_id=user.id, platform_admin=user.is_platform_admin))

        membership: Membership | None = None
        organization_id = session.active_organization_id

        if organization_id is not None:
            membership = self._active_membership(db, user.id, organization_id)
            if membership is None and not user.is_platform_admin:
                organization_id = None  # access was removed since the session chose it

        if organization_id is None:
            membership = self._default_membership(db, user.id)
            organization_id = membership.organization_id if membership else None
            session.active_organization_id = organization_id

        role: Role | None = None
        if membership is not None:
            role = membership.role
        elif organization_id is not None and user.is_platform_admin:
            role = Role.PLATFORM_ADMIN

        set_db_context(
            db,
            DbContext(
                organization_id=organization_id,
                user_id=user.id,
                platform_admin=user.is_platform_admin,
            ),
        )
        return Principal(
            user_id=user.id,
            email=user.email,
            full_name=user.full_name,
            is_platform_admin=user.is_platform_admin,
            session_id=session.id,
            organization_id=organization_id,
            membership_id=membership.id if membership else None,
            role=role,
            permissions=permissions_for(role, is_platform_admin=user.is_platform_admin),
        )

    @staticmethod
    def _active_membership(db: Session, user_id: UUID, organization_id: UUID) -> Membership | None:
        return db.scalar(
            select(Membership)
            .join(Organization, Organization.id == Membership.organization_id)
            .where(
                Membership.user_id == user_id,
                Membership.organization_id == organization_id,
                Membership.status == MembershipStatus.ACTIVE,
                Organization.status == OrganizationStatus.ACTIVE,
            )
        )

    @staticmethod
    def _default_membership(db: Session, user_id: UUID) -> Membership | None:
        return db.scalar(
            select(Membership)
            .join(Organization, Organization.id == Membership.organization_id)
            .where(
                Membership.user_id == user_id,
                Membership.status == MembershipStatus.ACTIVE,
                Organization.status == OrganizationStatus.ACTIVE,
            )
            .order_by(Organization.name, Membership.id)
            .limit(1)
        )

    # --- account actions -------------------------------------------------------------

    def me(self, ctx: Context) -> MeRead:
        principal = ctx.principal
        db = ctx.db
        session = db.get_one(AuthSession, principal.session_id)
        organization = (
            db.get(Organization, principal.organization_id) if principal.organization_id else None
        )
        rows = db.execute(
            select(Membership.role, Organization)
            .join(Organization, Organization.id == Membership.organization_id)
            .where(
                Membership.user_id == principal.user_id,
                Membership.status == MembershipStatus.ACTIVE,
                Organization.status == OrganizationStatus.ACTIVE,
            )
            .order_by(Organization.name)
        ).all()
        return MeRead(
            user=UserRead(
                id=principal.user_id,
                email=principal.email,
                full_name=principal.full_name,
                is_platform_admin=principal.is_platform_admin,
            ),
            organization=OrganizationRead.model_validate(organization) if organization else None,
            role=principal.role,
            permissions=sorted(principal.permissions),
            memberships=[
                MembershipSummary(organization=OrganizationSummary.model_validate(org), role=role)
                for role, org in rows
            ],
            session_expires_at=self._expiry(session),
        )

    def switch_organization(self, ctx: Context, organization_id: UUID) -> Context:
        """Make another organization active for this session. Returns the new context."""
        db = ctx.db
        principal = ctx.principal
        session = db.get_one(AuthSession, principal.session_id)
        user = db.get_one(User, principal.user_id)

        allowed = self._active_membership(db, user.id, organization_id) is not None
        if not allowed and user.is_platform_admin:
            allowed = db.get(Organization, organization_id) is not None
        if not allowed:
            # Same answer whether the organization does not exist or is not theirs.
            raise NotFoundError("Organization not found.")

        session.active_organization_id = organization_id
        db.flush()
        switched = Context(
            db=db, principal=self._build_principal(db, user, session), meta=ctx.meta, log=ctx.log
        )
        if switched.principal.role is Role.PLATFORM_ADMIN:
            audit.record(
                switched,
                action="platform.organization_entered",
                entity_type="organization",
                entity_id=organization_id,
                summary=f"Platform administrator {user.full_name} entered the organization",
            )
        return switched

    def logout(self, ctx: Context) -> None:
        session = ctx.db.get_one(AuthSession, ctx.principal.session_id)
        session.revoked_at = utcnow()

    def change_password(self, ctx: Context, *, current_password: str, new_password: str) -> None:
        db = ctx.db
        principal = ctx.principal
        user = db.get_one(User, principal.user_id)
        if not self._passwords.verify(user.password_hash, current_password):
            raise ValidationFailedError.for_field(
                "current_password", "The current password is not correct.", "incorrect_password"
            )
        self._passwords.validate_new_password(new_password, email=user.email, field="new_password")
        user.password_hash = self._passwords.hash(new_password)

        # Every other session ends: a changed password should lock out whoever knew the old one.
        db.execute(
            update(AuthSession)
            .where(
                AuthSession.user_id == user.id,
                AuthSession.id != principal.session_id,
                AuthSession.revoked_at.is_(None),
            )
            .values(revoked_at=utcnow())
        )
        if principal.organization_id or principal.is_platform_admin:
            audit.record(
                ctx,
                action="user.password_changed",
                entity_type="user",
                entity_id=user.id,
                summary=f"{user.full_name} changed their password",
            )
