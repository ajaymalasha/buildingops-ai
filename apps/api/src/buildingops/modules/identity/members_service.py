"""Managing who belongs to the active organization and with which role."""

from typing import Any
from uuid import UUID

from sqlalchemy import Select, select

from buildingops.core.context import Context
from buildingops.core.errors import (
    ConflictError,
    FieldProblem,
    NotFoundError,
    ValidationFailedError,
)
from buildingops.core.pagination import apply_sort, paginate_rows, search_pattern
from buildingops.core.permissions import Role
from buildingops.core.security import PasswordService
from buildingops.modules.audit import service as audit
from buildingops.modules.identity.models import Membership, MembershipStatus, User
from buildingops.modules.identity.schemas import (
    MemberCreate,
    MemberCreated,
    MemberFilters,
    MemberRead,
    MemberUpdate,
)

_SORTABLE = {
    "name": User.full_name,
    "email": User.email,
    "role": Membership.role,
    "created_at": Membership.created_at,
}


def _member_select(organization_id: UUID) -> Select[Membership, User]:
    return (
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.organization_id == organization_id)
    )


def _to_read(membership: Membership, user: User) -> MemberRead:
    return MemberRead(
        id=membership.id,
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=membership.role,
        status=membership.status,
        title=membership.title,
        last_login_at=user.last_login_at,
        created_at=membership.created_at,
    )


def list_members(ctx: Context, filters: MemberFilters) -> tuple[list[MemberRead], int]:
    statement = _member_select(ctx.organization_id)
    if filters.role:
        statement = statement.where(Membership.role == filters.role)
    if filters.status:
        statement = statement.where(Membership.status == filters.status)
    if filters.q:
        pattern = search_pattern(filters.q)
        statement = statement.where(
            User.full_name.ilike(pattern, escape="\\") | User.email.ilike(pattern, escape="\\")
        )
    statement = apply_sort(
        statement, filters.sort, allowed=_SORTABLE, default="name", tiebreaker=Membership.id
    )
    rows, total = paginate_rows(ctx.db, statement, filters)
    return [_to_read(membership, user) for membership, user in rows], total


def _get(ctx: Context, membership_id: UUID) -> tuple[Membership, User]:
    row = ctx.db.execute(
        _member_select(ctx.organization_id).where(Membership.id == membership_id)
    ).one_or_none()
    if row is None:
        raise NotFoundError("Member not found.")
    membership, user = row
    return membership, user


def get_member(ctx: Context, membership_id: UUID) -> MemberRead:
    return _to_read(*_get(ctx, membership_id))


def create_member(ctx: Context, passwords: PasswordService, data: MemberCreate) -> MemberCreated:
    """Give a person access to the active organization.

    If the email already has an account (they belong to another organization), only the
    membership is added: this organization's administrator cannot rename that person or
    reset their password.
    """
    db = ctx.db
    email = data.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    existing_account = user is not None

    if user is None:
        if not data.password:
            raise ValidationFailedError.for_field(
                "password", "Set an initial password for the new member.", "password_required"
            )
        passwords.validate_new_password(data.password, email=email)
        user = User(
            email=email, full_name=data.full_name, password_hash=passwords.hash(data.password)
        )
        db.add(user)
        db.flush()
    else:
        already_member = db.scalar(
            select(Membership.id).where(
                Membership.organization_id == ctx.organization_id, Membership.user_id == user.id
            )
        )
        if already_member is not None:
            raise ConflictError(
                "This person is already a member of the organization.",
                errors=[
                    FieldProblem(field="email", message="Already a member of this organization.")
                ],
            )

    membership = Membership(
        organization_id=ctx.organization_id,
        user_id=user.id,
        role=data.role,
        status=MembershipStatus.ACTIVE,
        title=data.title or None,
    )
    db.add(membership)
    db.flush()
    audit.record(
        ctx,
        action="member.added",
        entity_type="member",
        entity_id=membership.id,
        summary=f"Added {user.full_name} as {_role_label(data.role)}",
        changes={
            "email": {"from": None, "to": user.email},
            "role": {"from": None, "to": data.role},
        },
    )
    return MemberCreated(
        **_to_read(membership, user).model_dump(), existing_account=existing_account
    )


def update_member(ctx: Context, membership_id: UUID, data: MemberUpdate) -> MemberRead:
    membership, user = _get(ctx, membership_id)
    requested = data.model_dump(exclude_unset=True)
    if "role" in requested and requested["role"] is None:
        raise ValidationFailedError.for_field("role", "A member must have a role.")
    if "status" in requested and requested["status"] is None:
        raise ValidationFailedError.for_field("status", "A member must have a status.")
    if "title" in requested:
        requested["title"] = requested["title"] or None

    before = {"role": membership.role, "status": membership.status, "title": membership.title}
    changes = audit.changes_between(before, requested)
    if not changes:
        return _to_read(membership, user)

    changes_access = "role" in changes or "status" in changes
    if changes_access and membership.user_id == ctx.principal.user_id:
        raise ConflictError("You cannot change your own role or status. Ask another administrator.")

    loses_admin = membership.role is Role.COMPANY_ADMIN and (
        requested.get("role", Role.COMPANY_ADMIN) is not Role.COMPANY_ADMIN
        or requested.get("status", MembershipStatus.ACTIVE) is not MembershipStatus.ACTIVE
    )
    if loses_admin and membership.status is MembershipStatus.ACTIVE:
        _require_another_admin(ctx, excluding=membership.id)

    for field, value in requested.items():
        setattr(membership, field, value)
    ctx.db.flush()

    audit.record(
        ctx,
        action="member.updated",
        entity_type="member",
        entity_id=membership.id,
        summary=_describe_update(user.full_name, changes),
        changes=changes,
    )
    return _to_read(membership, user)


def _require_another_admin(ctx: Context, *, excluding: UUID) -> None:
    # Lock the organization's administrator rows so two concurrent demotions cannot both
    # pass this check and leave the organization with nobody able to manage it.
    remaining = ctx.db.scalars(
        select(Membership.id)
        .where(
            Membership.organization_id == ctx.organization_id,
            Membership.role == Role.COMPANY_ADMIN,
            Membership.status == MembershipStatus.ACTIVE,
        )
        .with_for_update()
    ).all()
    if not [member_id for member_id in remaining if member_id != excluding]:
        raise ConflictError("An organization must keep at least one active company administrator.")


def _role_label(role: Role) -> str:
    return role.value.replace("_", " ")


def _describe_update(name: str, changes: dict[str, Any]) -> str:
    parts = []
    if "role" in changes:
        parts.append(f"role to {str(changes['role']['to']).replace('_', ' ')}")
    if "status" in changes:
        parts.append(f"status to {changes['status']['to']}")
    if "title" in changes:
        parts.append("title")
    return f"Changed {name}'s {', '.join(parts)}"
