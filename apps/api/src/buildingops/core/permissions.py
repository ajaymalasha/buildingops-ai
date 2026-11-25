"""Roles and permissions.

Authorization is decided here and enforced in the API layer by `require(...)`. The web app
receives the permission list to decide what to show, which is a convenience, not a control.
"""

from enum import StrEnum


class Role(StrEnum):
    PLATFORM_ADMIN = "platform_admin"  # held by the user account, never by a membership
    COMPANY_ADMIN = "company_admin"
    OPERATIONS_MANAGER = "operations_manager"
    SUPERVISOR = "supervisor"
    EMPLOYEE = "employee"
    CUSTOMER = "customer"
    VENDOR = "vendor"


MEMBERSHIP_ROLES: tuple[Role, ...] = tuple(role for role in Role if role is not Role.PLATFORM_ADMIN)


class Permission(StrEnum):
    ORGANIZATION_READ = "organization:read"
    ORGANIZATION_UPDATE = "organization:update"
    MEMBERS_READ = "members:read"
    MEMBERS_MANAGE = "members:manage"
    AUDIT_READ = "audit:read"
    PLATFORM_ORGANIZATIONS = "platform:organizations"


_P = Permission

ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.PLATFORM_ADMIN: frozenset(Permission),
    Role.COMPANY_ADMIN: frozenset(
        {
            _P.ORGANIZATION_READ,
            _P.ORGANIZATION_UPDATE,
            _P.MEMBERS_READ,
            _P.MEMBERS_MANAGE,
            _P.AUDIT_READ,
        }
    ),
    Role.OPERATIONS_MANAGER: frozenset({_P.ORGANIZATION_READ, _P.MEMBERS_READ, _P.AUDIT_READ}),
    Role.SUPERVISOR: frozenset({_P.ORGANIZATION_READ, _P.MEMBERS_READ}),
    Role.EMPLOYEE: frozenset({_P.ORGANIZATION_READ}),
    Role.CUSTOMER: frozenset({_P.ORGANIZATION_READ}),
    Role.VENDOR: frozenset({_P.ORGANIZATION_READ}),
}

# What a platform administrator can do before entering an organization.
PLATFORM_ONLY_PERMISSIONS: frozenset[Permission] = frozenset({_P.PLATFORM_ORGANIZATIONS})


def permissions_for(role: Role | None, *, is_platform_admin: bool) -> frozenset[Permission]:
    if role is None:
        return PLATFORM_ONLY_PERMISSIONS if is_platform_admin else frozenset()
    granted = ROLE_PERMISSIONS[role]
    return granted | PLATFORM_ONLY_PERMISSIONS if is_platform_admin else granted
