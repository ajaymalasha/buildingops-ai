"""The active organization's profile, and platform-level organization management."""

import re
from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from buildingops.core.context import Context
from buildingops.core.errors import (
    ConflictError,
    FieldProblem,
    NotFoundError,
    ValidationFailedError,
)
from buildingops.core.pagination import paginate_rows, search_pattern
from buildingops.core.permissions import Role
from buildingops.core.security import PasswordService
from buildingops.modules.audit import service as audit
from buildingops.modules.identity.models import (
    Membership,
    MembershipStatus,
    Organization,
    OrganizationStatus,
    User,
)
from buildingops.modules.identity.schemas import (
    OrganizationCreate,
    OrganizationUpdate,
    PlatformOrganizationFilters,
    PlatformOrganizationRead,
)

_EDITABLE_FIELDS = ("name", "legal_name", "timezone", "currency")


def get_current(ctx: Context) -> Organization:
    organization = ctx.db.get(Organization, ctx.organization_id)
    if organization is None:
        raise NotFoundError("Organization not found.")
    return organization


def time_zone(ctx: Context) -> ZoneInfo:
    """The time zone the organization works in: where its days begin and end."""
    return ZoneInfo(get_current(ctx).timezone)


def today(ctx: Context) -> date:
    """Today's date where the organization works, which near midnight is not the server's."""
    return datetime.now(time_zone(ctx)).date()


def update_current(ctx: Context, data: OrganizationUpdate) -> Organization:
    organization = get_current(ctx)
    requested = data.model_dump(exclude_unset=True)
    for required in ("name", "timezone", "currency"):
        if required in requested and requested[required] is None:
            raise ValidationFailedError.for_field(required, "This field cannot be empty.")
    if "legal_name" in requested:
        requested["legal_name"] = requested["legal_name"] or None

    before = {field: getattr(organization, field) for field in _EDITABLE_FIELDS}
    changes = audit.changes_between(before, requested)
    if not changes:
        return organization

    for field, value in requested.items():
        setattr(organization, field, value)
    ctx.db.flush()
    audit.record(
        ctx,
        action="organization.updated",
        entity_type="organization",
        entity_id=organization.id,
        summary=f"Updated organization {', '.join(sorted(changes)).replace('_', ' ')}",
        changes=changes,
    )
    return organization


# --- platform administration -------------------------------------------------------------


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:80].rstrip("-")


def _with_member_count(organization: Organization, member_count: int) -> PlatformOrganizationRead:
    return PlatformOrganizationRead(
        **{
            field: getattr(organization, field)
            for field in PlatformOrganizationRead.model_fields
            if field != "member_count"
        },
        member_count=member_count,
    )


def list_organizations(
    ctx: Context, filters: PlatformOrganizationFilters
) -> tuple[list[PlatformOrganizationRead], int]:
    member_count = (
        select(func.count())
        .select_from(Membership)
        .where(
            Membership.organization_id == Organization.id,
            Membership.status == MembershipStatus.ACTIVE,
        )
        .correlate(Organization)
        .scalar_subquery()
    )
    statement = select(Organization, member_count.label("member_count"))
    if filters.status:
        statement = statement.where(Organization.status == filters.status)
    if filters.q:
        pattern = search_pattern(filters.q)
        statement = statement.where(
            Organization.name.ilike(pattern, escape="\\")
            | Organization.slug.ilike(pattern, escape="\\")
        )
    statement = statement.order_by(Organization.name, Organization.id)
    rows, total = paginate_rows(ctx.db, statement, filters)
    return [_with_member_count(organization, count) for organization, count in rows], total


def create_organization(
    ctx: Context, passwords: PasswordService, data: OrganizationCreate
) -> PlatformOrganizationRead:
    """Create a tenant together with its first company administrator."""
    db = ctx.db
    slug = data.slug or slugify(data.name)
    if not slug:
        raise ValidationFailedError.for_field("name", "Use a name with letters or numbers.")
    if db.scalar(select(Organization.id).where(Organization.slug == slug)) is not None:
        raise ConflictError(
            "An organization with this identifier already exists.",
            errors=[FieldProblem(field="slug", message=f"'{slug}' is already in use.")],
        )

    admin_email = data.admin_email.strip().lower()
    admin = db.scalar(select(User).where(User.email == admin_email))
    if admin is None:
        if not data.admin_password:
            raise ValidationFailedError.for_field(
                "admin_password",
                "Set an initial password for the new administrator.",
                "password_required",
            )
        passwords.validate_new_password(
            data.admin_password, email=admin_email, field="admin_password"
        )
        admin = User(
            email=admin_email,
            full_name=data.admin_full_name,
            password_hash=passwords.hash(data.admin_password),
        )
        db.add(admin)

    organization = Organization(
        name=data.name,
        slug=slug,
        legal_name=data.legal_name or None,
        timezone=data.timezone,
        currency=data.currency,
        status=OrganizationStatus.ACTIVE,
    )
    db.add(organization)
    db.flush()
    db.add(
        Membership(
            organization_id=organization.id,
            user_id=admin.id,
            role=Role.COMPANY_ADMIN,
            status=MembershipStatus.ACTIVE,
        )
    )
    db.flush()
    audit.record(
        ctx,
        action="organization.created",
        entity_type="organization",
        entity_id=organization.id,
        organization_id=organization.id,
        summary=f"Organization {organization.name} created with administrator {admin.full_name}",
    )
    return _with_member_count(organization, 1)


def set_organization_status(
    ctx: Context, organization_id: UUID, status: OrganizationStatus
) -> PlatformOrganizationRead:
    db = ctx.db
    organization = db.get(Organization, organization_id)
    if organization is None:
        raise NotFoundError("Organization not found.")
    if organization.status is not status:
        previous = organization.status
        organization.status = status
        db.flush()
        audit.record(
            ctx,
            action=f"organization.{status.value}",
            entity_type="organization",
            entity_id=organization.id,
            organization_id=organization.id,
            summary=f"Organization {organization.name} set to {status.value}",
            changes={"status": {"from": previous.value, "to": status.value}},
        )
    member_count = (
        db.scalar(
            select(func.count())
            .select_from(Membership)
            .where(
                Membership.organization_id == organization.id,
                Membership.status == MembershipStatus.ACTIVE,
            )
        )
        or 0
    )
    return _with_member_count(organization, member_count)
