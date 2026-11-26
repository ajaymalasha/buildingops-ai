"""What the year of work is built on: an organization's master data, and the day it is
built as of.

Everything is read once, in a fixed order, so that the same choices are made every time.
Archived rows are left out: no new history is written about them.
"""

import math
import random
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from buildingops.modules.buildings.models import Building
from buildingops.modules.contracts.models import Contract, ContractBuilding, ContractStatus
from buildingops.modules.customers.models import Customer
from buildingops.modules.identity.models import Membership, Organization
from buildingops.modules.vendors.models import Vendor, VendorCategory, VendorStatus
from buildingops.modules.workforce.models import (
    BuildingAssignment,
    Employee,
    EmployeeStatus,
    EmploymentType,
    JobRole,
)
from buildingops.seed.calendar import first_of_month
from buildingops.seed.catalog import DirectorySpec
from buildingops.seed.operations.catalog import DEFAULT_SHIFT_START, SHIFT_STARTS, TRADE_ROLES

# A row on its way into a bulk insert.
type Row = dict[str, Any]

# Whole months before the current one, so that every invoice covers a full month.
_HISTORY_MONTHS = 12

# The days of the week people work, Monday being 0, and how common each pattern is.
_WORKING_WEEKS = (
    frozenset({0, 1, 2, 3, 4}),
    frozenset({1, 2, 3, 4, 5}),
    frozenset({6, 0, 1, 2, 3}),
)
_WORKING_WEEK_WEIGHTS = (86, 9, 5)
_FULL_DAY = Decimal("8.00")
_PART_TIME_DAYS = (Decimal("4.00"), Decimal("5.00"), Decimal("6.00"))
# How often a day runs into overtime, by how someone is employed.
_OVERTIME_CHANCE = {
    EmploymentType.FULL_TIME: 0.08,
    EmploymentType.PART_TIME: 0.02,
    EmploymentType.TEMPORARY: 0.04,
    EmploymentType.CONTRACTOR: 0.0,
}


@dataclass(frozen=True, slots=True)
class Person:
    """Someone a record names: whoever decided on it, or wrote a line of its history.
    They have a `user_id` if they can sign in."""

    name: str
    user_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class Place:
    building: Building
    since: date


@dataclass(frozen=True, slots=True)
class Worker:
    """An active employee with a rate and somewhere to work, and the habits their time
    follows."""

    employee: Employee
    rate: Decimal
    role: str
    person: Person
    # Whoever decides on their time: their supervisor.
    approver: Person
    places: tuple[Place, ...]
    # Supervisors go round all their buildings. Crew stay at their primary one, apart from
    # one day a week at a second building if they have one.
    rotates: bool
    first_day: date
    weekdays: frozenset[int]
    away_weekday: int
    day_hours: Decimal
    overtime_chance: float
    starts: time

    def building_on(self, day: date) -> Building | None:
        """Where they are due on `day`, if it is one of their working days."""
        if day.weekday() not in self.weekdays:
            return None
        places = [place for place in self.places if place.since <= day]
        if not places:
            return None
        if self.rotates:
            return places[day.toordinal() % len(places)].building
        if len(places) > 1 and day.weekday() == self.away_weekday:
            return places[1].building
        return places[0].building


@dataclass(frozen=True, slots=True)
class Setting:
    organization: Organization
    spec: DirectorySpec
    today: date
    zone: ZoneInfo
    # The first day of the history, and the latest moment anything in the past is dated:
    # just before today began.
    first_day: date
    latest: datetime
    # Whoever runs operations. They decide on expenses, and stand in wherever a building
    # or a person has nobody above them.
    lead: Person
    workers: tuple[Worker, ...]
    # Those of them who take maintenance and repair work, wherever they are based.
    trades: tuple[Worker, ...]
    # Where work happens: the buildings with people at them, larger ones more often.
    sites: tuple[Building, ...]
    site_weights: tuple[float, ...]
    crew_at: dict[uuid.UUID, list[Worker]]
    in_charge: dict[uuid.UUID, Person]
    # Active contracts, and the one the work at each building is booked to.
    contracts: tuple[Contract, ...]
    main_contracts: dict[uuid.UUID, Contract]
    role_contracts: dict[tuple[uuid.UUID, str], Contract]
    vendors: dict[VendorCategory, list[Vendor]]
    contacts: dict[uuid.UUID, str | None]

    @property
    def history_days(self) -> int:
        return (self.today - self.first_day).days

    def local(self, day: date, at: time) -> datetime:
        """A time on the organization's clocks, as a moment in UTC. Arithmetic on the
        result counts real hours, whatever daylight saving does to the clocks meanwhile."""
        return datetime.combine(day, at, self.zone).astimezone(UTC)

    def stream(self, name: str) -> random.Random:
        return _stream(self.spec, name)

    def site(self, rng: random.Random) -> Building:
        return rng.choices(self.sites, self.site_weights)[0]

    def supervisor_of(self, building: Building) -> Person:
        return self.in_charge.get(building.id, self.lead)

    def contract_for(self, building: Building, role: str | None = None) -> Contract | None:
        """The contract that work at a building is booked to, for someone in `role`."""
        main = self.main_contracts.get(building.id)
        return self.role_contracts.get((building.id, role), main) if role else main


def load_setting(
    db: Session, organization: Organization, spec: DirectorySpec, today: date
) -> Setting:
    zone = ZoneInfo(organization.timezone)
    first_day = first_of_month(today, months_ago=_HISTORY_MONTHS)
    midnight = datetime.combine(today, time.min, zone).astimezone(UTC)

    staff = db.execute(
        select(Employee, JobRole, Membership.user_id)
        .join(JobRole, JobRole.id == Employee.job_role_id)
        .outerjoin(Membership, Membership.id == Employee.membership_id)
        .where(Employee.organization_id == organization.id)
        .order_by(Employee.employee_number, Employee.id)
    ).all()
    people = {employee.id: Person(employee.full_name, user_id) for employee, _, user_id in staff}
    lead = next(
        (
            people[employee.id]
            for employee, job_role, _ in staff
            if job_role.is_supervisory
            and employee.supervisor_id is None
            and employee.deleted_at is None
            and employee.status is EmployeeStatus.ACTIVE
        ),
        Person(organization.name, None),
    )

    places: defaultdict[uuid.UUID, list[Place]] = defaultdict(list)
    for assignment, building in db.execute(
        select(BuildingAssignment, Building)
        .join(Building, Building.id == BuildingAssignment.building_id)
        .where(
            BuildingAssignment.organization_id == organization.id,
            BuildingAssignment.ends_on.is_(None),
            Building.deleted_at.is_(None),
        )
        .order_by(BuildingAssignment.is_primary.desc(), Building.code)
    ):
        places[assignment.employee_id].append(Place(building, assignment.starts_on))

    rng = _stream(spec, "crew")
    workers = []
    for employee, job_role, _ in staff:
        # Everyone draws, whether or not they end up with time on record, so that one
        # person's circumstances do not shift the next person's habits.
        habits = _habits(rng, employee.employment_type)
        rate = employee.hourly_rate
        person = people[employee.id]
        approver = people[employee.supervisor_id] if employee.supervisor_id else lead
        if (
            employee.deleted_at is None
            and employee.status is EmployeeStatus.ACTIVE
            and rate is not None
            and places[employee.id]
            # Nobody approves their own time. Whoever has no one above them records none.
            and approver is not person
        ):
            workers.append(
                Worker(
                    employee=employee,
                    rate=rate,
                    role=job_role.name,
                    person=person,
                    approver=approver,
                    places=tuple(places[employee.id]),
                    rotates=job_role.is_supervisory,
                    first_day=max(first_day, employee.hire_date or first_day),
                    starts=SHIFT_STARTS.get(job_role.name, DEFAULT_SHIFT_START),
                    **habits,
                )
            )

    crew_at: defaultdict[uuid.UUID, list[Worker]] = defaultdict(list)
    in_charge: dict[uuid.UUID, Person] = {}
    for worker in workers:
        for place in worker.places:
            if worker.rotates:
                in_charge.setdefault(place.building.id, worker.person)
            else:
                crew_at[place.building.id].append(worker)

    buildings = db.scalars(
        select(Building)
        .where(Building.organization_id == organization.id, Building.deleted_at.is_(None))
        .order_by(Building.code)
    ).all()
    staffed = [b for b in buildings if b.id in crew_at or b.id in in_charge]
    sites = tuple(staffed or buildings)

    contracts, main_contracts, role_contracts = _contracts(db, organization, spec)
    vendors: defaultdict[VendorCategory, list[Vendor]] = defaultdict(list)
    for vendor in db.scalars(
        select(Vendor)
        .where(
            Vendor.organization_id == organization.id,
            Vendor.deleted_at.is_(None),
            Vendor.status == VendorStatus.ACTIVE,
        )
        .order_by(Vendor.code)
    ):
        vendors[vendor.category].append(vendor)
    contacts = dict(
        db.execute(
            select(Customer.id, Customer.contact_name).where(
                Customer.organization_id == organization.id
            )
        ).all()
    )
    return Setting(
        organization=organization,
        spec=spec,
        today=today,
        zone=zone,
        first_day=first_day,
        latest=midnight - timedelta(minutes=1),
        lead=lead,
        workers=tuple(workers),
        trades=tuple(worker for worker in workers if worker.role in TRADE_ROLES),
        sites=sites,
        site_weights=tuple(math.sqrt(building.square_feet or 1) for building in sites),
        crew_at=dict(crew_at),
        in_charge=in_charge,
        contracts=contracts,
        main_contracts=main_contracts,
        role_contracts=role_contracts,
        vendors=dict(vendors),
        contacts=contacts,
    )


def _stream(spec: DirectorySpec, name: str) -> random.Random:
    """A source of choices for one part of the history. Each part has its own, so that
    changing how one is built leaves the others as they were."""
    return random.Random(f"{spec.random_seed}:{name}")


def _habits(rng: random.Random, employment_type: EmploymentType) -> dict[str, Any]:
    """The week someone works, and the length of their day."""
    weekdays = rng.choices(_WORKING_WEEKS, _WORKING_WEEK_WEIGHTS)[0]
    part_time_day = rng.choice(_PART_TIME_DAYS)
    return {
        "weekdays": weekdays,
        "away_weekday": rng.choice(sorted(weekdays)),
        "day_hours": part_time_day if employment_type is EmploymentType.PART_TIME else _FULL_DAY,
        "overtime_chance": _OVERTIME_CHANCE[employment_type],
    }


def _contracts(
    db: Session, organization: Organization, spec: DirectorySpec
) -> tuple[tuple[Contract, ...], dict[uuid.UUID, Contract], dict[tuple[uuid.UUID, str], Contract]]:
    """The active contracts, and which of them the work at each building is booked to.

    A building's main contract is the active one covering it that started first. A
    contract the catalog marks as buying particular job roles takes those roles' time at
    its buildings instead.
    """
    by_role = {
        (contract.customer, contract.name): contract.job_roles
        for contract in spec.contracts
        if contract.job_roles
    }
    covered: defaultdict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for contract_id, building_id in db.execute(
        select(ContractBuilding.contract_id, ContractBuilding.building_id)
        .where(ContractBuilding.organization_id == organization.id)
        .order_by(ContractBuilding.building_id)
    ):
        covered[contract_id].append(building_id)

    contracts = []
    main_contracts: dict[uuid.UUID, Contract] = {}
    role_contracts: dict[tuple[uuid.UUID, str], Contract] = {}
    for contract, customer_name in db.execute(
        select(Contract, Customer.name)
        .join(Customer, Customer.id == Contract.customer_id)
        .where(
            Contract.organization_id == organization.id,
            Contract.status == ContractStatus.ACTIVE,
        )
        .order_by(Contract.start_date, Contract.contract_number)
    ):
        contracts.append(contract)
        roles = by_role.get((customer_name, contract.name), ())
        for building_id in covered[contract.id]:
            for role in roles:
                role_contracts.setdefault((building_id, role), contract)
            if not roles:
                main_contracts.setdefault(building_id, contract)
    return tuple(contracts), main_contracts, role_contracts
