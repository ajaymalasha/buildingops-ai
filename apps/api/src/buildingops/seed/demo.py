"""Demo data: two organizations and one account per role.

Runs as the owner role, which bypasses row-level security, so it can write across tenants.
Safe to run repeatedly: existing organizations, users and memberships are left as they are.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from buildingops.core.permissions import Role
from buildingops.core.security import PasswordService
from buildingops.modules.identity.models import (
    Membership,
    MembershipStatus,
    Organization,
    OrganizationStatus,
    User,
)


@dataclass(frozen=True, slots=True)
class DemoOrganization:
    slug: str
    name: str
    legal_name: str
    timezone: str


@dataclass(frozen=True, slots=True)
class DemoAccount:
    email: str
    full_name: str
    # (organization slug, role, job title)
    memberships: tuple[tuple[str, Role, str], ...] = ()
    is_platform_admin: bool = False


ORGANIZATIONS: tuple[DemoOrganization, ...] = (
    DemoOrganization(
        slug="meridian",
        name="Meridian Facility Services",
        legal_name="Meridian Facility Services, LLC",
        timezone="America/New_York",
    ),
    DemoOrganization(
        slug="northgate",
        name="Northgate Building Services",
        legal_name="Northgate Building Services, Inc.",
        timezone="America/Chicago",
    ),
)

ACCOUNTS: tuple[DemoAccount, ...] = (
    DemoAccount(
        email="dana.whitfield@meridianfs.example",
        full_name="Dana Whitfield",
        # Meridian and Northgate are sister companies; Dana oversees both.
        memberships=(
            ("meridian", Role.COMPANY_ADMIN, "Director of Operations"),
            ("northgate", Role.COMPANY_ADMIN, "Group Operations Director"),
        ),
    ),
    DemoAccount(
        email="marcus.okafor@meridianfs.example",
        full_name="Marcus Okafor",
        memberships=(("meridian", Role.OPERATIONS_MANAGER, "Operations Manager"),),
    ),
    DemoAccount(
        email="priya.raman@meridianfs.example",
        full_name="Priya Raman",
        memberships=(("meridian", Role.SUPERVISOR, "Site Supervisor"),),
    ),
    DemoAccount(
        email="luis.ortega@meridianfs.example",
        full_name="Luis Ortega",
        memberships=(("meridian", Role.EMPLOYEE, "Maintenance Technician"),),
    ),
    DemoAccount(
        email="helen.brandt@northgatebs.example",
        full_name="Helen Brandt",
        memberships=(("northgate", Role.COMPANY_ADMIN, "General Manager"),),
    ),
    DemoAccount(
        email="omar.haddad@northgatebs.example",
        full_name="Omar Haddad",
        memberships=(("northgate", Role.OPERATIONS_MANAGER, "Operations Manager"),),
    ),
    DemoAccount(
        email="platform.admin@buildingops.example",
        full_name="Jordan Reyes",
        is_platform_admin=True,
    ),
)


@dataclass(slots=True)
class SeedReport:
    organizations_created: int = 0
    users_created: int = 0
    memberships_created: int = 0


def seed_identity(db: Session, passwords: PasswordService, demo_password: str) -> SeedReport:
    report = SeedReport()

    organizations: dict[str, Organization] = {}
    for spec in ORGANIZATIONS:
        organization = db.scalar(select(Organization).where(Organization.slug == spec.slug))
        if organization is None:
            organization = Organization(
                slug=spec.slug,
                name=spec.name,
                legal_name=spec.legal_name,
                timezone=spec.timezone,
                currency="USD",
                status=OrganizationStatus.ACTIVE,
            )
            db.add(organization)
            report.organizations_created += 1
        organizations[spec.slug] = organization
    db.flush()

    password_hash = passwords.hash(demo_password)
    for account in ACCOUNTS:
        user = db.scalar(select(User).where(User.email == account.email))
        if user is None:
            user = User(
                email=account.email,
                full_name=account.full_name,
                password_hash=password_hash,
                is_platform_admin=account.is_platform_admin,
            )
            db.add(user)
            db.flush()
            report.users_created += 1

        for slug, role, title in account.memberships:
            organization = organizations[slug]
            exists = db.scalar(
                select(Membership.id).where(
                    Membership.organization_id == organization.id, Membership.user_id == user.id
                )
            )
            if exists is None:
                db.add(
                    Membership(
                        organization_id=organization.id,
                        user_id=user.id,
                        role=role,
                        status=MembershipStatus.ACTIVE,
                        title=title,
                    )
                )
                report.memberships_created += 1
    db.flush()
    return report
