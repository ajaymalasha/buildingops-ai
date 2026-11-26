"""Demo master data for the seeded organizations.

Customers, buildings, vendors, job roles, employees with their building assignments, and
contracts, built from the lists in `catalog.py`. Like the identity seed, it runs as the
owner role and writes rows directly: nobody did these things, so nothing goes into the
audit log.

The result is deterministic. Every choice comes from a `random.Random` seeded per
organization, and every date is placed relative to the day the seed runs, so the demo
always has insurance about to lapse and contracts that ended a few months ago.
"""

import math
import random
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from itertools import cycle, pairwise
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from buildingops.modules.buildings.models import Building, BuildingStatus
from buildingops.modules.buildings.service import BUILDING_CODES
from buildingops.modules.contracts.models import Contract, ContractBuilding
from buildingops.modules.contracts.service import CONTRACT_NUMBERS
from buildingops.modules.customers.models import Customer
from buildingops.modules.customers.service import CUSTOMER_CODES
from buildingops.modules.identity.models import Membership, Organization, User
from buildingops.modules.sequences.service import CodeSeries, allocate_code
from buildingops.modules.vendors.models import Vendor
from buildingops.modules.vendors.service import VENDOR_CODES
from buildingops.modules.workforce.employees_service import EMPLOYEE_NUMBERS
from buildingops.modules.workforce.models import (
    BuildingAssignment,
    Employee,
    EmployeeStatus,
    EmploymentType,
    JobRole,
)
from buildingops.seed.catalog import (
    DIRECTORIES,
    FIRST_NAMES,
    LAST_NAMES,
    STREETS,
    CustomerSpec,
    DirectorySpec,
    JobRoleSpec,
    LoginSpec,
    Place,
)

_SIX_YEARS = 6 * 365
_PAYMENT_TERMS = (30, 30, 30, 45, 60)
_VENDOR_MAILBOXES = ("service", "dispatch", "accounts")
# Most crew members are full time. Supervisors always are.
_CREW_EMPLOYMENT = (
    EmploymentType.FULL_TIME,
    EmploymentType.PART_TIME,
    EmploymentType.TEMPORARY,
    EmploymentType.CONTRACTOR,
)
_CREW_EMPLOYMENT_WEIGHTS = (70, 22, 5, 3)
# Share of crew members who have a work email, and who also cover a second building.
_CREW_WITH_EMAIL = 0.4
_CREW_WITH_SECOND_BUILDING = 0.2


@dataclass(slots=True)
class DirectoryReport:
    """What one run created for an organization. All zeros if it already had customers."""

    organization_slug: str
    customers: int = 0
    buildings: int = 0
    vendors: int = 0
    job_roles: int = 0
    employees: int = 0
    assignments: int = 0
    contracts: int = 0


def seed_master_data(db: Session, today: date | None = None) -> list[DirectoryReport]:
    """Give each demo organization its master data, unless it already has customers.

    `today` anchors the dates. It defaults to the current date where the organization is.
    """
    reports = []
    for spec in DIRECTORIES:
        organization = db.scalars(
            select(Organization).where(Organization.slug == spec.organization_slug)
        ).one()
        report = DirectoryReport(spec.organization_slug)
        any_customer = db.scalar(
            select(Customer.id).where(Customer.organization_id == organization.id).limit(1)
        )
        if any_customer is None:
            anchor = today or datetime.now(ZoneInfo(organization.timezone)).date()
            _DirectorySeeder(db, organization, spec, anchor, report).run()
        reports.append(report)
    return reports


@dataclass(slots=True)
class _Account:
    spec: CustomerSpec
    customer: Customer
    buildings: list[Building] = field(default_factory=list)


@dataclass(slots=True)
class _Hire:
    employee: Employee
    role: JobRoleSpec
    hired_on: date
    left_on: date | None


class _DirectorySeeder:
    def __init__(
        self,
        db: Session,
        organization: Organization,
        spec: DirectorySpec,
        today: date,
        report: DirectoryReport,
    ) -> None:
        self.db = db
        self.organization = organization
        self.spec = spec
        self.today = today
        self.report = report
        self.random = random.Random(spec.random_seed)
        # First names are dealt from a shuffled deck, so that one comes round again only
        # after all the others have been used.
        self._first_names = cycle(self.random.sample(FIRST_NAMES, len(FIRST_NAMES)))
        # Full names already taken: no two seeded people share one.
        self._names = {(login.first_name, login.last_name) for login in spec.logins}

    def run(self) -> None:
        # Each step flushes: the rows of the next one refer to the rows of this one.
        accounts = self._accounts()
        self._vendors()
        job_roles = self._job_roles()
        hires = self._hires(job_roles)
        buildings = [building for account in accounts.values() for building in account.buildings]
        self._organize(hires, buildings)
        self._contracts(accounts)

    # --- customers and their buildings ---------------------------------------------------

    def _accounts(self) -> dict[str, _Account]:
        accounts = {}
        for spec in self.spec.customers:
            place = spec.buildings[0].place if spec.buildings else self._place()
            first_name, last_name = self._person()
            customer = Customer(
                organization_id=self.organization.id,
                name=spec.name,
                code=self._next(CUSTOMER_CODES),
                status=spec.status,
                contact_name=f"{first_name} {last_name}",
                email=_email(first_name, last_name, spec.email_domain),
                phone=self._phone(place),
                **self._address(place),
                payment_terms_days=self.random.choice(_PAYMENT_TERMS),
            )
            accounts[spec.name] = _Account(spec, customer)
        self.db.add_all(account.customer for account in accounts.values())
        self.db.flush()

        for account in accounts.values():
            account.buildings = [
                Building(
                    organization_id=self.organization.id,
                    customer_id=account.customer.id,
                    name=building.name,
                    code=self._next(BUILDING_CODES),
                    building_type=building.building_type,
                    status=building.status,
                    address_line1=building.address_line1,
                    city=building.place.city,
                    region=building.place.region,
                    postal_code=building.place.postal_code,
                    square_feet=building.square_feet,
                    floors=building.floors,
                )
                for building in account.spec.buildings
            ]
        self.db.add_all(b for account in accounts.values() for b in account.buildings)
        self.db.flush()

        self.report.customers = len(accounts)
        self.report.buildings = sum(len(account.buildings) for account in accounts.values())
        return accounts

    # --- vendors -------------------------------------------------------------------------

    def _vendors(self) -> None:
        vendors = []
        for spec in self.spec.vendors:
            place = self._place()
            first_name, last_name = self._person()
            days_left = spec.insurance_days_left
            vendors.append(
                Vendor(
                    organization_id=self.organization.id,
                    name=spec.name,
                    code=self._next(VENDOR_CODES),
                    category=spec.category,
                    status=spec.status,
                    contact_name=f"{first_name} {last_name}",
                    email=f"{self.random.choice(_VENDOR_MAILBOXES)}@{spec.email_domain}",
                    phone=self._phone(place),
                    **self._address(place),
                    insurance_expires_on=(
                        None if days_left is None else self.today + timedelta(days=days_left)
                    ),
                    payment_terms_days=self.random.choice(_PAYMENT_TERMS),
                )
            )
        self.db.add_all(vendors)
        self.db.flush()
        self.report.vendors = len(vendors)

    # --- job roles and employees ---------------------------------------------------------

    def _job_roles(self) -> dict[str, JobRole]:
        job_roles = {
            spec.name: JobRole(
                organization_id=self.organization.id,
                name=spec.name,
                description=spec.description,
                default_hourly_rate=Decimal(spec.default_hourly_rate),
                is_supervisory=spec.is_supervisory,
            )
            for spec in self.spec.job_roles
        }
        self.db.add_all(job_roles.values())
        self.db.flush()
        self.report.job_roles = len(job_roles)
        return job_roles

    def _hires(self, job_roles: dict[str, JobRole]) -> list[_Hire]:
        """One employee per position. The seeded accounts take the first of their role."""
        positions: list[tuple[JobRoleSpec, LoginSpec | None]] = []
        for role in self.spec.job_roles:
            logins = [login for login in self.spec.logins if login.job_role == role.name]
            vacancies: list[LoginSpec | None] = [None] * (role.headcount - len(logins))
            positions.extend((role, login) for login in logins + vacancies)

        # A few crew members are new, away or gone. Supervisors and the seeded accounts
        # stay active, so that every team has someone to report to and every login works.
        crew = [
            index
            for index, (role, login) in enumerate(positions)
            if login is None and not role.is_supervisory
        ]
        unusual = (
            [EmployeeStatus.ONBOARDING] * self.spec.onboarding
            + [EmployeeStatus.ON_LEAVE] * self.spec.on_leave
            + [EmployeeStatus.TERMINATED] * self.spec.terminated
        )
        statuses = dict(zip(self.random.sample(crew, len(unusual)), unusual, strict=True))

        hires = [
            self._hire(
                role, job_roles[role.name], login, statuses.get(index, EmployeeStatus.ACTIVE)
            )
            for index, (role, login) in enumerate(positions)
        ]
        self.db.add_all(hire.employee for hire in hires)
        self.db.flush()
        self.report.employees = len(hires)
        return hires

    def _hire(
        self, role: JobRoleSpec, job_role: JobRole, login: LoginSpec | None, status: EmployeeStatus
    ) -> _Hire:
        if login is not None:
            first_name, last_name = login.first_name, login.last_name
            email: str | None = login.email
        else:
            first_name, last_name = self._person()
            has_email = role.is_supervisory or self.random.random() < _CREW_WITH_EMAIL
            email = _email(first_name, last_name, self.spec.email_domain) if has_email else None
        hired_on, left_on = self._employment_dates(status)
        employee = Employee(
            organization_id=self.organization.id,
            employee_number=self._next(EMPLOYEE_NUMBERS),
            first_name=first_name,
            last_name=last_name,
            email=email,
            phone=self._phone(self._place()),
            job_role_id=job_role.id,
            membership_id=self._membership_id(login.email) if login else None,
            employment_type=(
                EmploymentType.FULL_TIME
                if role.is_supervisory
                else self.random.choices(_CREW_EMPLOYMENT, _CREW_EMPLOYMENT_WEIGHTS)[0]
            ),
            status=status,
            hire_date=hired_on,
            termination_date=left_on,
            # The role's rate plus up to three dollars, in quarters.
            hourly_rate=Decimal(role.default_hourly_rate) + Decimal(self.random.randrange(13)) / 4,
        )
        return _Hire(employee, role, hired_on, left_on)

    def _employment_dates(self, status: EmployeeStatus) -> tuple[date, date | None]:
        if status is EmployeeStatus.ONBOARDING:
            return self.today + timedelta(days=self.random.randint(-10, 14)), None
        if status is EmployeeStatus.TERMINATED:
            hired_on = self.today - timedelta(days=self.random.randint(240, _SIX_YEARS))
            days_worked = self.random.randint(90, (self.today - hired_on).days - 14)
            return hired_on, hired_on + timedelta(days=days_worked)
        return self.today - timedelta(days=self.random.randint(45, _SIX_YEARS)), None

    def _membership_id(self, email: str) -> uuid.UUID | None:
        return self.db.scalar(
            select(Membership.id)
            .join(User, User.id == Membership.user_id)
            .where(Membership.organization_id == self.organization.id, User.email == email)
        )

    # --- who reports to whom, and who works where ----------------------------------------

    def _organize(self, hires: list[_Hire], buildings: list[Building]) -> None:
        # Supervisory roles are listed from the top down: each level reports to the one
        # above it, and the first person at the top is in charge.
        levels = [
            [hire for hire in hires if hire.role is role]
            for role in self.spec.job_roles
            if role.is_supervisory
        ]
        head, *deputies = levels[0]
        for deputy in deputies:
            deputy.employee.supervisor_id = head.employee.id
        for above, level in pairwise(levels):
            for index, hire in enumerate(level):
                hire.employee.supervisor_id = above[index % len(above)].employee.id

        # Each site supervisor looks after a run of buildings. The first is their base.
        site_supervisors = levels[-1]
        staffed = [b for b in buildings if b.status is not BuildingStatus.INACTIVE]
        assignments: list[BuildingAssignment] = []
        in_charge: dict[uuid.UUID, _Hire] = {}
        for position, supervisor in enumerate(site_supervisors):
            first = position * len(staffed) // len(site_supervisors)
            after_last = (position + 1) * len(staffed) // len(site_supervisors)
            for building in staffed[first:after_last]:
                in_charge[building.id] = supervisor
                assignments.append(
                    self._assignment(supervisor, building, is_primary=building is staffed[first])
                )

        crew = [hire for hire in hires if not hire.role.is_supervisory]
        pull = [math.sqrt(building.square_feet or 1) for building in staffed]
        for index, hire in enumerate(crew):
            # First someone for every building. After that, larger buildings draw more people.
            building = (
                staffed[index] if index < len(staffed) else self.random.choices(staffed, pull)[0]
            )
            supervisor = in_charge[building.id]
            hire.employee.supervisor_id = supervisor.employee.id
            assignments.append(self._assignment(hire, building, is_primary=True))

            nearby = [b for b in staffed if in_charge[b.id] is supervisor and b is not building]
            covers_another = (
                hire.left_on is None
                and hire.hired_on < self.today
                and self.random.random() < _CREW_WITH_SECOND_BUILDING
            )
            if covers_another and nearby:
                since = hire.hired_on + timedelta(days=self.random.randint(30, 400))
                assignments.append(
                    self._assignment(
                        hire,
                        self.random.choice(nearby),
                        is_primary=False,
                        starts_on=min(since, self.today),
                    )
                )

        self.db.add_all(assignments)
        self.db.flush()
        self.report.assignments = len(assignments)

    def _assignment(
        self, hire: _Hire, building: Building, *, is_primary: bool, starts_on: date | None = None
    ) -> BuildingAssignment:
        """From the day they were hired, unless told otherwise, until the day they left."""
        return BuildingAssignment(
            organization_id=self.organization.id,
            employee_id=hire.employee.id,
            building_id=building.id,
            is_primary=is_primary,
            starts_on=starts_on or hire.hired_on,
            ends_on=hire.left_on,
        )

    # --- contracts -----------------------------------------------------------------------

    def _contracts(self, accounts: dict[str, _Account]) -> None:
        for spec in self.spec.contracts:
            account = accounts[spec.customer]
            start = _first_of_month(self.today, months_ago=spec.started_months_ago)
            contract = Contract(
                organization_id=self.organization.id,
                customer_id=account.customer.id,
                contract_number=self._next(CONTRACT_NUMBERS),
                name=spec.name,
                status=spec.status,
                billing_model=spec.billing_model,
                start_date=start,
                end_date=(
                    _first_of_month(start, months_ago=-spec.term_months) - timedelta(days=1)
                    if spec.term_months
                    else None
                ),
                markup_percent=Decimal(spec.markup_percent) if spec.markup_percent else None,
                monthly_fee=Decimal(spec.monthly_fee) if spec.monthly_fee else None,
                currency=self.organization.currency,
                payment_terms_days=account.customer.payment_terms_days,
            )
            self.db.add(contract)
            self.db.flush()
            self.db.add_all(
                ContractBuilding(
                    organization_id=self.organization.id,
                    contract_id=contract.id,
                    building_id=building.id,
                )
                for building in account.buildings[: spec.building_count]
            )
        self.db.flush()
        self.report.contracts = len(self.spec.contracts)

    # --- small pieces --------------------------------------------------------------------

    def _next(self, series: CodeSeries) -> str:
        """Codes come from the same sequences the API uses, so it carries on from here."""
        return allocate_code(self.db, self.organization.id, series.name, series.prefix)

    def _person(self) -> tuple[str, str]:
        while True:
            name = next(self._first_names), self.random.choice(LAST_NAMES)
            if name not in self._names:
                self._names.add(name)
                return name

    def _place(self) -> Place:
        return self.random.choice(self.spec.places)

    def _phone(self, place: Place) -> str:
        # 555-0100 to 555-0199 is the range set aside for fiction.
        return f"({place.area_code}) 555-01{self.random.randrange(100):02d}"

    def _address(self, place: Place) -> dict[str, str | None]:
        number = self.random.randint(11, 980)
        suite = self.random.randint(2, 28) * 100
        return {
            "address_line1": f"{number} {self.random.choice(STREETS)}",
            "address_line2": self.random.choice((None, None, f"Suite {suite}")),
            "city": place.city,
            "region": place.region,
            "postal_code": place.postal_code,
        }


def _email(first_name: str, last_name: str, domain: str) -> str:
    return f"{first_name}.{last_name}@{domain}".lower()


def _first_of_month(day: date, *, months_ago: int) -> date:
    months = day.year * 12 + day.month - 1 - months_ago
    return date(months // 12, months % 12 + 1, 1)
