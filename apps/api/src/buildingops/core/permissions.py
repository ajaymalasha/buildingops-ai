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
    CUSTOMERS_READ = "customers:read"
    CUSTOMERS_WRITE = "customers:write"
    BUILDINGS_READ = "buildings:read"
    BUILDINGS_WRITE = "buildings:write"
    VENDORS_READ = "vendors:read"
    VENDORS_WRITE = "vendors:write"
    # Employees, their job roles and their building assignments.
    EMPLOYEES_READ = "employees:read"
    EMPLOYEES_WRITE = "employees:write"
    # Pay rates on employees and job roles: to see them and, with write access, to set them.
    EMPLOYEES_READ_COMPENSATION = "employees:read_compensation"
    CONTRACTS_READ = "contracts:read"
    CONTRACTS_WRITE = "contracts:write"
    # Work orders: to add and edit them, move them through their statuses and comment.
    WORK_ORDERS_READ = "work_orders:read"
    WORK_ORDERS_WRITE = "work_orders:write"
    # Shifts.
    SCHEDULE_READ = "schedule:read"
    SCHEDULE_WRITE = "schedule:write"
    TIMESHEETS_READ = "timesheets:read"
    TIMESHEETS_WRITE = "timesheets:write"
    # To approve, reject and reopen. The same for expenses.
    TIMESHEETS_APPROVE = "timesheets:approve"
    EXPENSES_READ = "expenses:read"
    EXPENSES_WRITE = "expenses:write"
    EXPENSES_APPROVE = "expenses:approve"
    # Invoices and the payments received against them.
    INVOICES_READ = "invoices:read"
    # What the business costs and earns, added up across every building and contract.
    DASHBOARD_READ = "dashboard:read"
    PLATFORM_ORGANIZATIONS = "platform:organizations"


_P = Permission

_MASTER_DATA_READ: frozenset[Permission] = frozenset(
    {_P.CUSTOMERS_READ, _P.BUILDINGS_READ, _P.VENDORS_READ, _P.EMPLOYEES_READ}
)
_MASTER_DATA_MANAGE: frozenset[Permission] = _MASTER_DATA_READ | {
    _P.CUSTOMERS_WRITE,
    _P.BUILDINGS_WRITE,
    _P.VENDORS_WRITE,
    _P.EMPLOYEES_WRITE,
    _P.EMPLOYEES_READ_COMPENSATION,
    _P.CONTRACTS_READ,
    _P.CONTRACTS_WRITE,
}
# The day-to-day records a supervisor keeps for their sites, and their crews' time to approve.
_OPERATIONS_RUN: frozenset[Permission] = frozenset(
    {
        _P.WORK_ORDERS_READ,
        _P.WORK_ORDERS_WRITE,
        _P.SCHEDULE_READ,
        _P.SCHEDULE_WRITE,
        _P.TIMESHEETS_READ,
        _P.TIMESHEETS_WRITE,
        _P.TIMESHEETS_APPROVE,
        _P.EXPENSES_READ,
        _P.EXPENSES_WRITE,
    }
)
# Approving spending and seeing what customers are billed stay with managers. So does the
# dashboard, which adds up what labor costs and what each contract earns.
_OPERATIONS_MANAGE: frozenset[Permission] = _OPERATIONS_RUN | {
    _P.EXPENSES_APPROVE,
    _P.INVOICES_READ,
    _P.DASHBOARD_READ,
}

ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.PLATFORM_ADMIN: frozenset(Permission),
    Role.COMPANY_ADMIN: _MASTER_DATA_MANAGE
    | _OPERATIONS_MANAGE
    | {
        _P.ORGANIZATION_READ,
        _P.ORGANIZATION_UPDATE,
        _P.MEMBERS_READ,
        _P.MEMBERS_MANAGE,
        _P.AUDIT_READ,
    },
    Role.OPERATIONS_MANAGER: _MASTER_DATA_MANAGE
    | _OPERATIONS_MANAGE
    | {_P.ORGANIZATION_READ, _P.MEMBERS_READ, _P.AUDIT_READ},
    # Supervisors see the directory they work in, but neither pay rates nor contract terms.
    Role.SUPERVISOR: _MASTER_DATA_READ | _OPERATIONS_RUN | {_P.ORGANIZATION_READ, _P.MEMBERS_READ},
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
