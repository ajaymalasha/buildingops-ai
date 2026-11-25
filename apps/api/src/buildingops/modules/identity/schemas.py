from datetime import datetime
from typing import Annotated
from uuid import UUID
from zoneinfo import available_timezones

from pydantic import AfterValidator, EmailStr, Field, StringConstraints

from buildingops.core.pagination import PageParams
from buildingops.core.permissions import MEMBERSHIP_ROLES, Permission, Role
from buildingops.core.schemas import RequestModel, ResponseModel
from buildingops.modules.identity.models import MembershipStatus, OrganizationStatus


def _valid_timezone(value: str) -> str:
    if value not in available_timezones():
        raise ValueError("Unknown time zone. Use an IANA name such as America/New_York.")
    return value


def _assignable_role(value: Role) -> Role:
    if value not in MEMBERSHIP_ROLES:
        raise ValueError("This role cannot be assigned to a member.")
    return value


Name = Annotated[str, StringConstraints(min_length=1, max_length=200)]
Timezone = Annotated[str, AfterValidator(_valid_timezone)]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=80)]
AssignableRole = Annotated[Role, AfterValidator(_assignable_role)]
# Length limits only. Strength rules live in PasswordService so they apply everywhere.
Password = Annotated[str, StringConstraints(min_length=1, max_length=128, strip_whitespace=False)]


# --- organizations ---------------------------------------------------------------------


class OrganizationSummary(ResponseModel):
    id: UUID
    name: str
    slug: str


class OrganizationRead(OrganizationSummary):
    legal_name: str | None
    timezone: str
    currency: str
    status: OrganizationStatus
    created_at: datetime
    updated_at: datetime


class OrganizationUpdate(RequestModel):
    name: Name | None = None
    legal_name: Annotated[str, StringConstraints(max_length=200)] | None = None
    timezone: Timezone | None = None
    currency: Currency | None = None


class PlatformOrganizationRead(OrganizationRead):
    member_count: int


class OrganizationCreate(RequestModel):
    name: Name
    slug: Slug | None = Field(default=None, description="Generated from the name when omitted.")
    legal_name: Annotated[str, StringConstraints(max_length=200)] | None = None
    timezone: Timezone = "America/New_York"
    currency: Currency = "USD"
    admin_email: EmailStr
    admin_full_name: Name
    admin_password: Password | None = Field(
        default=None, description="Required unless the administrator already has an account."
    )


class OrganizationStatusUpdate(RequestModel):
    status: OrganizationStatus


class PlatformOrganizationFilters(PageParams):
    q: str | None = Field(default=None, max_length=200)
    status: OrganizationStatus | None = None


# --- authentication --------------------------------------------------------------------


class UserRead(ResponseModel):
    id: UUID
    email: str
    full_name: str
    is_platform_admin: bool


class MembershipSummary(ResponseModel):
    organization: OrganizationSummary
    role: Role


class MeRead(ResponseModel):
    """The signed-in user, their active organization and what they may do in it."""

    user: UserRead
    organization: OrganizationRead | None
    role: Role | None
    permissions: list[Permission]
    memberships: list[MembershipSummary]
    session_expires_at: datetime


class LoginRequest(RequestModel):
    email: Annotated[str, StringConstraints(min_length=3, max_length=320)]
    password: Password


class LoginResponse(ResponseModel):
    session_token: str = Field(description="Bearer token. Shown once; store it server-side.")
    expires_at: datetime
    me: MeRead


class SwitchOrganizationRequest(RequestModel):
    organization_id: UUID


class ChangePasswordRequest(RequestModel):
    current_password: Password
    new_password: Password


# --- members ---------------------------------------------------------------------------


class MemberRead(ResponseModel):
    id: UUID = Field(description="Membership id.")
    user_id: UUID
    email: str
    full_name: str
    role: Role
    status: MembershipStatus
    title: str | None
    last_login_at: datetime | None
    created_at: datetime


class MemberCreated(MemberRead):
    existing_account: bool = Field(
        description="True when the email already had an account and only access was added."
    )


class MemberCreate(RequestModel):
    email: EmailStr
    full_name: Name
    role: AssignableRole
    title: Annotated[str, StringConstraints(max_length=120)] | None = None
    password: Password | None = Field(
        default=None,
        description="Initial password. Required unless the email already has an account.",
    )


class MemberUpdate(RequestModel):
    role: AssignableRole | None = None
    status: MembershipStatus | None = None
    title: Annotated[str, StringConstraints(max_length=120)] | None = None


class MemberFilters(PageParams):
    q: str | None = Field(default=None, max_length=200, description="Search name and email.")
    role: Role | None = None
    status: MembershipStatus | None = None
    sort: str | None = Field(default=None, description="One of name, email, role, created_at.")
