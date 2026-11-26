"""The dashboard's figures, each proved against a small set of books added up by hand.

The books are for March 2026, which is compared with the 31 days before it: 29 January to
28 February. Beside every record that counts there is one that must not: a pending or a
rejected one, a draft, a void invoice, one dated a day outside the period, and another
organization's.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from itertools import pairwise
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from buildingops.core.db import Database, DbContext
from buildingops.core.models import DecisionStatus, utcnow
from buildingops.core.permissions import Role
from buildingops.modules.analytics import service
from buildingops.modules.analytics.definitions import OPEN_STATUSES
from buildingops.modules.analytics.periods import (
    Period,
    first_of_month,
    last_of_month,
    months_to_date,
)
from buildingops.modules.analytics.schemas import (
    BuildingsQuery,
    ContractsQuery,
    SummaryQuery,
    TrendsQuery,
    WorkOrdersQuery,
)
from buildingops.modules.buildings.models import Building, BuildingStatus
from buildingops.modules.contracts.models import BillingModel, Contract
from buildingops.modules.customers.models import Customer
from buildingops.modules.expenses.models import ExpenseCategory
from buildingops.modules.identity.models import Organization
from buildingops.modules.invoicing.models import InvoiceStatus
from buildingops.modules.vendors.models import VendorStatus
from buildingops.modules.workforce.models import EmployeeStatus
from buildingops.modules.workorders.models import (
    WorkOrderCategory,
    WorkOrderPriority,
    WorkOrderStatus,
)
from tests.conftest import Actor, ActorFactory, Factory, problem

DASHBOARD = "/api/v1/dashboard"
ENDPOINTS = ("summary", "trends", "contracts", "buildings", "work-orders")

NEW_YORK = ZoneInfo("America/New_York")
MARCH = {"from": "2026-03-01", "to": "2026-03-31"}

PENDING, APPROVED, REJECTED = (
    DecisionStatus.PENDING,
    DecisionStatus.APPROVED,
    DecisionStatus.REJECTED,
)
DRAFT, ISSUED, PAID, VOID = (
    InvoiceStatus.DRAFT,
    InvoiceStatus.ISSUED,
    InvoiceStatus.PAID,
    InvoiceStatus.VOID,
)
_S = WorkOrderStatus
_C = WorkOrderCategory
_P = WorkOrderPriority


def _money(amount: str) -> Decimal:
    return Decimal(amount)


def _day(month: int, day: int) -> date:
    return date(2026, month, day)


def _at(month: int, day: int, clock: str, zone: ZoneInfo = NEW_YORK) -> datetime:
    """A moment in 2026, given as the day and the time that clocks in `zone` showed."""
    return datetime.combine(date(2026, month, day), time.fromisoformat(clock), zone)


def _today(organization: Organization) -> date:
    return datetime.now(ZoneInfo(organization.timezone)).date()


def _get(actor: Actor, endpoint: str, **params: Any) -> dict[str, Any]:
    response = actor.get(f"{DASHBOARD}/{endpoint}", params=params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _figure(value: str, previous: str, change: str, change_percent: str | None) -> dict[str, Any]:
    return {
        "value": value,
        "previous": previous,
        "change": change,
        "change_percent": change_percent,
    }


def _line(
    revenue: str, labor_cost: str, expense_cost: str, operating_cost: str, margin: str, percent
) -> dict[str, Any]:
    return {
        "revenue": revenue,
        "labor_cost": labor_cost,
        "expense_cost": expense_cost,
        "operating_cost": operating_cost,
        "margin": margin,
        "margin_percent": percent,
    }


def _costs(*shares: tuple[str, str | None]) -> list[dict[str, Any]]:
    """Operating cost by category, in the order the API lists it: labor, then each kind
    of expense. Each is an amount and its share of the whole."""
    categories = ["labor", *(category.value for category in ExpenseCategory)]
    return [
        {"category": category, "amount": amount, "share_percent": share}
        for category, (amount, share) in zip(categories, shares, strict=True)
    ]


# --- the books ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Books:
    """An organization in New York with two customers, three buildings and three contracts.

    Harbor Realty has Tower One, under the janitorial contract, and Pier Nine Depot,
    under the repairs contract. Calloway Group has Granite Plaza, under the porters
    contract.
    """

    admin: Actor
    today: date
    harbor: Customer
    calloway: Customer
    tower: Building
    depot: Building
    plaza: Building
    janitorial: Contract
    repairs: Contract
    porters: Contract


@pytest.fixture
def books(make_actor: ActorFactory, factory: Factory) -> Books:
    admin = make_actor()
    organization = admin.organization
    assert organization.timezone == "America/New_York"
    today = _today(organization)
    yesterday = today - timedelta(days=1)

    harbor = factory.customer(organization, name="Harbor Realty")
    calloway = factory.customer(organization, name="Calloway Group")
    tower = factory.building(organization, harbor, name="Tower One", code="TWR")
    depot = factory.building(
        organization, harbor, name="Pier Nine Depot", code="DPT", status=BuildingStatus.INACTIVE
    )
    plaza = factory.building(organization, calloway, name="Granite Plaza", code="PLZ")
    factory.building(organization, harbor, name="Old Mill", deleted_at=utcnow())  # archived
    janitorial = factory.contract(
        organization,
        harbor,
        buildings=[tower],
        contract_number="K-1",
        name="Janitorial",
        billing_model=BillingModel.COST_PLUS,
        markup_percent=_money("12.50"),
    )
    porters = factory.contract(
        organization, calloway, buildings=[plaza], contract_number="K-2", name="Porters"
    )
    repairs = factory.contract(
        organization, harbor, buildings=[depot], contract_number="K-3", name="Repairs"
    )
    k1, k2, k3 = janitorial.id, porters.id, repairs.id

    maria = factory.employee(organization, first_name="Maria", last_name="Lopez")
    sam = factory.employee(organization, first_name="Sam", last_name="Reed")
    factory.employee(organization, status=EmployeeStatus.TERMINATED)
    factory.employee(organization, deleted_at=utcnow())  # archived
    factory.vendor(organization)
    factory.vendor(organization, status=VendorStatus.PENDING_COMPLIANCE)
    factory.vendor(organization, deleted_at=utcnow())  # archived

    # --- time: Maria is paid 20.00 an hour and Sam 25.00 ---
    def worked(employee, building, day, hours="8.00", overtime="0.00", rate="20.00", **fields):
        factory.timesheet(
            employee,
            building,
            work_date=day,
            hours_regular=_money(hours),
            hours_overtime=_money(overtime),
            hourly_rate=_money(rate),
            **fields,
        )

    # Approved, in March, on its first and last days too: 160.00 + 220.00 + 150.00 + 100.00.
    worked(maria, tower, _day(3, 1), status=APPROVED, contract_id=k1)
    worked(maria, tower, _day(3, 31), overtime="2.00", status=APPROVED, contract_id=k1)
    worked(sam, depot, _day(3, 10), hours="6.00", rate="25.00", status=APPROVED)
    worked(sam, plaza, _day(3, 12), hours="4.00", rate="25.00", status=APPROVED, contract_id=k2)
    # Not a cost: waiting for a decision (8.00 and 4.50 hours), or turned down.
    worked(maria, tower, _day(3, 15), contract_id=k1)
    worked(sam, depot, _day(3, 20), hours="3.00", overtime="1.50", rate="25.00")
    worked(maria, tower, _day(3, 16), status=REJECTED, contract_id=k1)
    # Approved in the period before, on its first and last days: 80.00 + 160.00.
    worked(maria, tower, _day(1, 29), hours="4.00", status=APPROVED, contract_id=k1)
    worked(maria, tower, _day(2, 28), status=APPROVED, contract_id=k1)
    # Approved, a day outside both periods.
    worked(maria, tower, _day(1, 28), status=APPROVED, contract_id=k1)
    worked(maria, tower, _day(4, 1), status=APPROVED, contract_id=k1)

    # --- expenses ---
    def spent(category, amount, day, **fields):
        factory.expense(
            organization, category=category, amount=_money(amount), incurred_on=day, **fields
        )

    at_tower = {"building_id": tower.id, "contract_id": k1}
    # Approved, in March: 125.00 + 300.50 + 1,000.00 + 74.50 + 40.25. The last names no
    # building and no contract.
    spent(ExpenseCategory.SUPPLIES, "125.00", _day(3, 1), status=APPROVED, **at_tower)
    spent(ExpenseCategory.MATERIALS, "300.50", _day(3, 31), status=APPROVED, **at_tower)
    spent(
        ExpenseCategory.SUBCONTRACTOR,
        "1000.00",
        _day(3, 15),
        status=APPROVED,
        building_id=depot.id,
        contract_id=k3,
    )
    spent(
        ExpenseCategory.EQUIPMENT,
        "74.50",
        _day(3, 20),
        status=APPROVED,
        building_id=plaza.id,
        contract_id=k2,
    )
    spent(ExpenseCategory.SUPPLIES, "40.25", _day(3, 5), status=APPROVED)
    # Not a cost: waiting for a decision (999.99 and 0.01), or turned down.
    spent(ExpenseCategory.TRAVEL, "999.99", _day(3, 10), **at_tower)
    spent(ExpenseCategory.OTHER, "0.01", _day(3, 11))
    spent(ExpenseCategory.MATERIALS, "500.00", _day(3, 12), status=REJECTED, **at_tower)
    # Approved in the period before, and a day outside both periods.
    spent(ExpenseCategory.SUPPLIES, "200.00", _day(2, 28), status=APPROVED, **at_tower)
    spent(ExpenseCategory.SUPPLIES, "70.00", _day(1, 28), status=APPROVED, **at_tower)
    spent(ExpenseCategory.SUPPLIES, "60.00", _day(4, 1), status=APPROVED, **at_tower)

    # --- invoices, and what was received on them ---
    def billed(customer, number, status, total, issued=None, due=None, paid=(), **fields):
        factory.invoice(
            organization,
            customer,
            number=number,
            status=status,
            subtotal=_money(total),
            issue_date=issued,
            due_date=due,
            payments=[
                {"amount": _money(amount), "received_on": received} for amount, received in paid
            ],
            **fields,
        )

    later = date(2031, 1, 1)
    # Revenue in March: 2,000.00 + 500.00 + 800.00 + 150.75, on its first and last days too.
    # INV-A is due today, which is not yet overdue. INV-C was due yesterday.
    billed(
        harbor,
        "INV-A",
        ISSUED,
        "2000.00",
        _day(3, 1),
        today,
        paid=[("250.00", _day(3, 31))],
        contract_id=k1,
    )
    billed(
        harbor,
        "INV-B",
        PAID,
        "500.00",
        _day(3, 31),
        later,
        paid=[("500.00", _day(4, 2))],
        contract_id=k1,
    )
    billed(
        calloway,
        "INV-C",
        ISSUED,
        "800.00",
        _day(3, 15),
        yesterday,
        paid=[("300.00", _day(3, 20))],
        contract_id=k2,
    )
    billed(harbor, "INV-D", PAID, "150.75", _day(3, 10), later, paid=[("150.75", _day(3, 12))])
    # Revenue in the period before: 1,000.00 + 300.00. INV-I has been paid in full without
    # being marked paid, so nothing is outstanding on it.
    billed(
        harbor,
        "INV-E",
        PAID,
        "1000.00",
        _day(2, 10),
        later,
        paid=[("600.00", _day(2, 20)), ("400.00", _day(3, 1))],
        contract_id=k1,
    )
    billed(
        calloway,
        "INV-I",
        ISSUED,
        "300.00",
        _day(1, 29),
        yesterday,
        paid=[("300.00", _day(1, 29))],
        contract_id=k2,
    )
    # Never revenue: a draft, even one that has been given a date, and a void invoice. What
    # was received on the void one before it was taken back was still received.
    billed(harbor, "INV-G", DRAFT, "9999.00", _day(3, 10), contract_id=k1)
    billed(
        harbor,
        "INV-H",
        VOID,
        "700.00",
        _day(3, 5),
        yesterday,
        paid=[("50.00", _day(3, 6))],
        contract_id=k1,
    )
    # Issued a day outside both periods. INV-F is still owed in full.
    billed(harbor, "INV-F", ISSUED, "1200.00", _day(4, 1), later, contract_id=k1)
    billed(
        harbor,
        "INV-J",
        PAID,
        "111.00",
        _day(1, 28),
        later,
        paid=[("111.00", _day(1, 28))],
        contract_id=k1,
    )

    # --- work orders: when each was raised and finished is New York time ---
    def job(building, status, raised, category, priority, **fields):
        factory.work_order(
            organization,
            building,
            status=status,
            created_at=raised,
            category=category,
            priority=priority,
            **fields,
        )

    # The backlog: four open in some way, two of them overdue. Due today is not overdue.
    job(tower, _S.OPEN, _at(3, 3, "10:00"), _C.CLEANING, _P.HIGH, due_on=yesterday)
    # Raised at 23:30 on 31 March in New York, which is already 1 April in UTC.
    job(tower, _S.SCHEDULED, _at(3, 31, "23:30"), _C.HVAC, _P.NORMAL, due_on=today)
    job(depot, _S.IN_PROGRESS, _at(2, 10, "09:00"), _C.REPAIR, _P.URGENT)
    job(
        plaza,
        _S.ON_HOLD,
        _at(4, 1, "00:30"),
        _C.PLUMBING,
        _P.LOW,
        due_on=today - timedelta(days=40),
    )
    # Finished in March: a quarter past midnight on the 1st and a quarter to midnight on
    # the 31st, which is 1 April in UTC.
    job(
        tower,
        _S.COMPLETED,
        _at(2, 27, "09:00"),
        _C.CLEANING,
        _P.NORMAL,
        completed_at=_at(3, 1, "00:15"),
        due_on=today - timedelta(days=100),
    )
    job(
        plaza,
        _S.COMPLETED,
        _at(3, 30, "08:00"),
        _C.HVAC,
        _P.NORMAL,
        completed_at=_at(3, 31, "23:45"),
    )
    # Finished ten minutes into April, and in the period before.
    job(
        depot,
        _S.COMPLETED,
        _at(3, 20, "08:00"),
        _C.REPAIR,
        _P.HIGH,
        completed_at=_at(4, 1, "00:10"),
    )
    job(
        tower,
        _S.COMPLETED,
        _at(2, 1, "08:00"),
        _C.CLEANING,
        _P.LOW,
        completed_at=_at(2, 15, "12:00"),
    )
    # Cancelled work is not open, however late it was.
    job(
        tower,
        _S.CANCELLED,
        _at(3, 5, "08:00"),
        _C.CLEANING,
        _P.NORMAL,
        due_on=today - timedelta(days=5),
    )

    _another_organizations_books(factory)
    return Books(admin, today, harbor, calloway, tower, depot, plaza, janitorial, repairs, porters)


def _another_organizations_books(factory: Factory) -> Organization:
    """One of everything the dashboard counts, in March, for somebody else."""
    elsewhere = factory.organization()
    customer = factory.customer(elsewhere)
    building = factory.building(elsewhere, customer)
    contract = factory.contract(elsewhere, customer, buildings=[building])
    employee = factory.employee(elsewhere)
    factory.vendor(elsewhere)
    on_contract = {"building_id": building.id, "contract_id": contract.id}
    factory.timesheet(
        employee, building, work_date=_day(3, 10), status=APPROVED, contract_id=contract.id
    )
    factory.timesheet(employee, building, work_date=_day(3, 11))
    # And time this month, whenever the tests are run, for the trends to leave out.
    factory.timesheet(
        employee, building, work_date=_month_start(_today(elsewhere)), status=APPROVED
    )
    factory.expense(elsewhere, incurred_on=_day(3, 10), status=APPROVED, **on_contract)
    factory.expense(elsewhere, incurred_on=_day(3, 11), **on_contract)
    factory.invoice(
        elsewhere,
        customer,
        status=ISSUED,
        issue_date=_day(3, 10),
        due_date=_day(3, 20),
        contract_id=contract.id,
        payments=[{"amount": _money("100.00"), "received_on": _day(3, 20)}],
    )
    factory.work_order(elsewhere, building, created_at=_at(3, 10, "09:00"), due_on=_day(3, 12))
    factory.work_order(
        elsewhere,
        building,
        status=_S.COMPLETED,
        created_at=_at(3, 10, "09:00"),
        completed_at=_at(3, 11, "09:00"),
    )
    return elsewhere


# --- the summary -------------------------------------------------------------------------


def test_the_summary_adds_up_what_counts_and_leaves_out_what_does_not(books: Books):
    summary = _get(books.admin, "summary", **MARCH)

    assert summary == {
        "period": {"start": "2026-03-01", "end": "2026-03-31", "days": 31},
        # The 31 days that end the day before March starts.
        "previous_period": {"start": "2026-01-29", "end": "2026-02-28", "days": 31},
        "as_of": books.today.isoformat(),
        "currency": "USD",
        "scope": {
            "building_id": None,
            "customer_id": None,
            "organization_wide": [],
            "by_contract": [],
        },
        # INV-A, B, C and D, against INV-E and I before: 2,150.75 more, on 1,300.00.
        "revenue": _figure("3450.75", "1300.00", "2150.75", "165.4"),
        # 160.00 + 220.00 + 150.00 + 100.00, against 80.00 + 160.00.
        "labor_cost": _figure("630.00", "240.00", "390.00", "162.5"),
        # 125.00 + 300.50 + 1,000.00 + 74.50 + 40.25, against 200.00.
        "expense_cost": _figure("1540.25", "200.00", "1340.25", "670.1"),
        "operating_cost": _figure("2170.25", "440.00", "1730.25", "393.2"),
        # 3,450.75 - 2,170.25, against 1,300.00 - 440.00.
        "margin": _figure("1280.50", "860.00", "420.50", "48.9"),
        # 1,280.50 of 3,450.75 is 37.108%, and 860.00 of 1,300.00 is 66.154%.
        "margin_percent": {"value": "37.1", "previous": "66.2", "change": "-29.1"},
        # Received in March on INV-A, C, D, E and the void INV-H: 250.00 + 300.00 + 150.75
        # + 400.00 + 50.00. Before it: 600.00 on INV-E and 300.00 on INV-I.
        "collected": _figure("1150.75", "900.00", "250.75", "27.9"),
        "work_orders_completed": {
            "value": 2,
            "previous": 1,
            "change": 1,
            "change_percent": "100.0",
        },
        "cost_by_category": _costs(
            ("630.00", "29.0"),  # labor
            ("300.50", "13.8"),  # materials
            ("74.50", "3.4"),  # equipment
            ("1000.00", "46.1"),  # subcontractor
            ("165.25", "7.6"),  # supplies: 125.00 + 40.25
            ("0.00", "0.0"),  # travel: the only one is still pending
            ("0.00", "0.0"),  # other
        ),
        # Still owed: 1,750.00 on INV-A, 500.00 on INV-C and 1,200.00 on INV-F.
        "invoices_outstanding": {"count": 3, "amount": "3450.00"},
        "invoices_overdue": {"count": 1, "amount": "500.00"},
        "work_orders_open": 4,
        "work_orders_overdue": 2,
        "timesheets_pending": {"count": 2, "hours": "12.50"},
        "expenses_pending": {"count": 2, "amount": "1000.00"},
        # Archived ones are not counted at all.
        "buildings": {"total": 3, "active": 2},
        "employees": {"total": 3, "active": 2},
        "vendors": {"total": 2, "active": 1},
    }


def test_the_cost_breakdown_comes_to_the_costs_and_the_costs_to_the_margin(books: Books):
    summary = _get(books.admin, "summary", **MARCH)

    def value(figure: str) -> Decimal:
        return Decimal(summary[figure]["value"])

    by_category = {
        line["category"]: Decimal(line["amount"]) for line in summary["cost_by_category"]
    }
    labor = by_category.pop("labor")
    assert labor == value("labor_cost")
    assert sum(by_category.values()) == value("expense_cost")
    assert value("labor_cost") + value("expense_cost") == value("operating_cost")
    assert value("revenue") - value("operating_cost") == value("margin")


def test_a_period_is_compared_with_the_period_of_equal_length_just_before_it(books: Books):
    def compared(first: str, last: str) -> tuple[dict, dict]:
        summary = _get(books.admin, "summary", **{"from": first, "to": last})
        return summary["previous_period"], summary["labor_cost"]

    # One day is compared with the day before it.
    assert compared("2026-03-01", "2026-03-01") == (
        {"start": "2026-02-28", "end": "2026-02-28", "days": 1},
        _figure("160.00", "160.00", "0.00", "0.0"),
    )
    # The previous period's own figures are those of that period asked for directly.
    march = _get(books.admin, "summary", **MARCH)
    before = _get(books.admin, "summary", **{"from": "2026-01-29", "to": "2026-02-28"})
    for figure in ("revenue", "labor_cost", "expense_cost", "operating_cost", "margin"):
        assert march[figure]["previous"] == before[figure]["value"], figure
    assert march["margin_percent"]["previous"] == before["margin_percent"]["value"]
    assert march["collected"]["previous"] == before["collected"]["value"]
    assert march["work_orders_completed"]["previous"] == before["work_orders_completed"]["value"]
    # A quarter is compared with the 90 days before it, a leap day among them or not.
    assert compared("2026-01-01", "2026-03-31")[0] == {
        "start": "2025-10-03",
        "end": "2025-12-31",
        "days": 90,
    }
    assert compared("2028-03-01", "2028-03-31")[0] == {
        "start": "2028-01-30",
        "end": "2028-02-29",
        "days": 31,
    }


def test_a_change_from_nothing_has_no_percentage(books: Books):
    # Nothing at all happened in the 31 days before 29 January.
    summary = _get(books.admin, "summary", **{"from": "2026-01-29", "to": "2026-02-28"})

    assert summary["revenue"] == _figure("1300.00", "111.00", "1189.00", "1071.2")
    assert summary["expense_cost"] == _figure("200.00", "70.00", "130.00", "185.7")
    assert summary["work_orders_completed"] == {
        "value": 1,
        "previous": 0,
        "change": 1,
        "change_percent": None,
    }
    # And a fall is measured against the size of what it fell from.
    april = _get(books.admin, "summary", **{"from": "2026-04-01", "to": "2026-05-01"})
    assert april["previous_period"] == {"start": "2026-03-01", "end": "2026-03-31", "days": 31}
    assert april["revenue"] == _figure("1200.00", "3450.75", "-2250.75", "-65.2")
    # 1,200.00 - 220.00 is 980.00, where March made 1,280.50.
    assert april["margin"] == _figure("980.00", "1280.50", "-300.50", "-23.5")


def test_a_change_from_a_loss_is_measured_against_the_size_of_the_loss(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    # February: 125.00 spent and nothing invoiced. March: 1,000.00 invoiced, nothing spent.
    factory.expense(organization, incurred_on=_day(2, 10), status=APPROVED)
    factory.invoice(organization, status=PAID, issue_date=_day(3, 10))

    summary = _get(admin, "summary", **MARCH)

    # Up by 1,125.00 from a loss of 125.00: nine times the loss, and upwards.
    assert summary["margin"] == _figure("1000.00", "-125.00", "1125.00", "900.0")
    assert summary["operating_cost"] == _figure("0.00", "125.00", "-125.00", "-100.0")
    # A loss with no revenue has no percentage, so there is no change in it to state.
    assert summary["margin_percent"] == {"value": "100.0", "previous": None, "change": None}


def test_a_percentage_too_small_to_show_is_zero_without_a_sign(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    # March: 100,000.00 invoiced and 100,000.50 spent. A loss of fifty cents is 0.0005% of
    # the revenue, which to one place is nothing: "0.0", and never "-0.0".
    customer = factory.customer(organization)
    contract = factory.contract(organization, customer)
    factory.invoice(
        organization,
        customer,
        contract_id=contract.id,
        status=ISSUED,
        issue_date=_day(3, 10),
        subtotal=Decimal("100000.00"),
    )
    factory.expense(
        organization,
        contract_id=contract.id,
        incurred_on=_day(3, 12),
        status=APPROVED,
        amount=Decimal("100000.50"),
    )
    # February: the same revenue, and a cent less of it than in March would be.
    factory.invoice(
        organization, status=PAID, issue_date=_day(2, 10), subtotal=Decimal("100000.01")
    )

    summary = _get(admin, "summary", **MARCH)

    assert summary["margin"]["value"] == "-0.50"
    assert summary["margin_percent"]["value"] == "0.0"
    # Revenue fell by a cent: a fall, of 0.0%.
    assert summary["revenue"] == _figure("100000.00", "100000.01", "-0.01", "0.0")
    line = _get(admin, "contracts", **MARCH)["contracts"][0]
    assert (line["margin"], line["margin_percent"]) == ("-0.50", "0.0")


# --- narrowing ---------------------------------------------------------------------------


def test_a_building_narrows_costs_and_work_to_itself_and_invoices_to_its_contracts(
    books: Books,
):
    summary = _get(books.admin, "summary", building_id=str(books.tower.id), **MARCH)

    assert summary == {
        "period": {"start": "2026-03-01", "end": "2026-03-31", "days": 31},
        "previous_period": {"start": "2026-01-29", "end": "2026-02-28", "days": 31},
        "as_of": books.today.isoformat(),
        "currency": "USD",
        "scope": {
            "building_id": str(books.tower.id),
            "customer_id": None,
            # Nothing ties an employee or a vendor to a building.
            "organization_wide": ["employees", "vendors"],
            # An invoice is for a contract. The janitorial contract covers Tower One, so
            # its invoices count in full.
            "by_contract": [
                "revenue",
                "margin",
                "margin_percent",
                "collected",
                "invoices_outstanding",
                "invoices_overdue",
            ],
        },
        # INV-A and INV-B, against INV-E. INV-D names no contract, so it covers no building.
        "revenue": _figure("2500.00", "1000.00", "1500.00", "150.0"),
        # Maria's time: 160.00 + 220.00, against 80.00 + 160.00.
        "labor_cost": _figure("380.00", "240.00", "140.00", "58.3"),
        # 125.00 + 300.50, against 200.00: 225.50 more is 112.75%, and the half goes up.
        "expense_cost": _figure("425.50", "200.00", "225.50", "112.8"),
        "operating_cost": _figure("805.50", "440.00", "365.50", "83.1"),
        "margin": _figure("1694.50", "560.00", "1134.50", "202.6"),
        "margin_percent": {"value": "67.8", "previous": "56.0", "change": "11.8"},
        # On the janitorial contract's invoices: 250.00 on INV-A, 400.00 on INV-E and 50.00
        # on INV-H, against 600.00 on INV-E.
        "collected": _figure("700.00", "600.00", "100.00", "16.7"),
        "work_orders_completed": {
            "value": 1,
            "previous": 1,
            "change": 0,
            "change_percent": "0.0",
        },
        "cost_by_category": _costs(
            ("380.00", "47.2"),
            ("300.50", "37.3"),
            ("0.00", "0.0"),
            ("0.00", "0.0"),
            ("125.00", "15.5"),
            ("0.00", "0.0"),
            ("0.00", "0.0"),
        ),
        # 1,750.00 on INV-A and 1,200.00 on INV-F. Neither is overdue.
        "invoices_outstanding": {"count": 2, "amount": "2950.00"},
        "invoices_overdue": {"count": 0, "amount": "0.00"},
        "work_orders_open": 2,
        "work_orders_overdue": 1,
        "timesheets_pending": {"count": 1, "hours": "8.00"},
        "expenses_pending": {"count": 1, "amount": "999.99"},
        "buildings": {"total": 1, "active": 1},
        # The whole organization's, as `scope` says.
        "employees": {"total": 3, "active": 2},
        "vendors": {"total": 2, "active": 1},
    }


def test_a_customer_narrows_costs_and_work_to_its_buildings_and_invoices_to_its_own(
    books: Books,
):
    harbor = _get(books.admin, "summary", customer_id=str(books.harbor.id), **MARCH)
    calloway = _get(books.admin, "summary", customer_id=str(books.calloway.id), **MARCH)

    assert harbor["scope"] == {
        "building_id": None,
        "customer_id": str(books.harbor.id),
        "organization_wide": ["employees", "vendors"],
        # A customer's invoices are its own: nothing is only roughly narrowed.
        "by_contract": [],
    }
    # Tower One and Pier Nine Depot: 380.00 + 150.00 of labor, 425.50 + 1,000.00 of expenses.
    # The 40.25 that names no building is nobody's.
    assert harbor["labor_cost"] == _figure("530.00", "240.00", "290.00", "120.8")
    assert harbor["expense_cost"] == _figure("1425.50", "200.00", "1225.50", "612.8")
    # INV-A, INV-B and INV-D, which names no contract but is Harbor's all the same.
    assert harbor["revenue"] == _figure("2650.75", "1000.00", "1650.75", "165.1")
    assert harbor["margin"] == _figure("695.25", "560.00", "135.25", "24.2")
    assert harbor["margin_percent"] == {"value": "26.2", "previous": "56.0", "change": "-29.8"}
    # 250.00 + 150.75 + 400.00 + 50.00.
    assert harbor["collected"] == _figure("850.75", "600.00", "250.75", "41.8")
    assert harbor["work_orders_completed"]["value"] == 1
    assert harbor["invoices_outstanding"] == {"count": 2, "amount": "2950.00"}
    assert harbor["invoices_overdue"] == {"count": 0, "amount": "0.00"}
    assert (harbor["work_orders_open"], harbor["work_orders_overdue"]) == (3, 1)
    assert harbor["timesheets_pending"] == {"count": 2, "hours": "12.50"}
    # The pending 0.01 names no building.
    assert harbor["expenses_pending"] == {"count": 1, "amount": "999.99"}
    # Tower One and the depot, which is inactive. Old Mill is archived.
    assert harbor["buildings"] == {"total": 2, "active": 1}

    assert calloway["labor_cost"]["value"] == "100.00"
    assert calloway["expense_cost"]["value"] == "74.50"
    assert calloway["revenue"] == _figure("800.00", "300.00", "500.00", "166.7")
    assert calloway["margin"]["value"] == "625.50"
    assert calloway["margin_percent"]["value"] == "78.2"
    assert calloway["collected"] == _figure("300.00", "300.00", "0.00", "0.0")
    assert calloway["invoices_outstanding"] == {"count": 1, "amount": "500.00"}
    assert calloway["invoices_overdue"] == {"count": 1, "amount": "500.00"}
    assert (calloway["work_orders_open"], calloway["work_orders_overdue"]) == (1, 1)
    assert calloway["buildings"] == {"total": 1, "active": 1}

    # The two customers and what belongs to neither make up the whole.
    everything = _get(books.admin, "summary", **MARCH)
    assert Decimal(harbor["labor_cost"]["value"]) + Decimal(calloway["labor_cost"]["value"]) == (
        Decimal(everything["labor_cost"]["value"])
    )
    assert Decimal(harbor["revenue"]["value"]) + Decimal(calloway["revenue"]["value"]) == (
        Decimal(everything["revenue"]["value"])
    )
    assert Decimal(harbor["expense_cost"]["value"]) + Decimal(
        calloway["expense_cost"]["value"]
    ) == Decimal(everything["expense_cost"]["value"]) - Decimal("40.25")


def test_a_building_and_a_customer_narrow_together(books: Books):
    def narrowed(building: Building, customer: Customer) -> dict:
        return _get(
            books.admin,
            "summary",
            building_id=str(building.id),
            customer_id=str(customer.id),
            **MARCH,
        )

    own = narrowed(books.depot, books.harbor)
    not_theirs = narrowed(books.plaza, books.harbor)

    # The depot is Harbor's: its costs, and Harbor's invoices under the contract that
    # covers it, which has none.
    assert own["labor_cost"]["value"] == "150.00"
    assert own["expense_cost"]["value"] == "1000.00"
    assert own["revenue"]["value"] == "0.00"
    assert own["margin"]["value"] == "-1150.00"
    assert own["margin_percent"] == {"value": None, "previous": None, "change": None}
    assert own["buildings"] == {"total": 1, "active": 0}
    # Granite Plaza is not Harbor's, so the two together match nothing.
    for figure in ("revenue", "labor_cost", "expense_cost", "operating_cost", "margin"):
        assert not_theirs[figure] == _figure("0.00", "0.00", "0.00", None), figure
    assert not_theirs["invoices_outstanding"] == {"count": 0, "amount": "0.00"}
    assert not_theirs["work_orders_open"] == 0
    assert not_theirs["buildings"] == {"total": 0, "active": 0}


def test_an_archived_building_keeps_what_was_spent_there(books: Books, factory: Factory):
    organization = books.admin.organization
    mill = factory.building(organization, books.harbor, name="Stone Mill", deleted_at=utcnow())
    factory.timesheet(factory.employee(organization), mill, work_date=_day(3, 9), status=APPROVED)

    at_the_mill = _get(books.admin, "summary", building_id=str(mill.id), **MARCH)
    harbor = _get(books.admin, "summary", customer_id=str(books.harbor.id), **MARCH)
    compared = _get(books.admin, "buildings", **MARCH)["buildings"]

    assert at_the_mill["labor_cost"]["value"] == "160.00"
    assert harbor["labor_cost"]["value"] == "690.00"  # 530.00 and the mill's 160.00
    # It is no longer one of the customer's buildings to count.
    assert at_the_mill["buildings"] == {"total": 0, "active": 0}
    assert harbor["buildings"] == {"total": 2, "active": 1}
    assert "Stone Mill" in [line["building"]["name"] for line in compared]


# --- contracts ---------------------------------------------------------------------------


def _contract_line(contract: Contract, customer: Customer, **figures: Any) -> dict[str, Any]:
    return {
        "contract": {
            "id": str(contract.id),
            "contract_number": contract.contract_number,
            "name": contract.name,
        },
        "customer": {"id": str(customer.id), "name": customer.name, "code": customer.code},
        "billing_model": contract.billing_model.value,
        **figures,
    }


def test_each_contract_is_set_against_its_costs_and_the_lines_come_to_the_totals(books: Books):
    profitability = _get(books.admin, "contracts", **MARCH)

    assert profitability == {
        "period": {"start": "2026-03-01", "end": "2026-03-31", "days": 31},
        "currency": "USD",
        # Largest margin first.
        "contracts": [
            # INV-A and INV-B, against Maria's time and what was bought for Tower One.
            _contract_line(
                books.janitorial,
                books.harbor,
                **_line("2500.00", "380.00", "425.50", "805.50", "1694.50", "67.8"),
            ),
            # INV-C, against Sam's four hours and the equipment: 625.50 of 800.00.
            _contract_line(
                books.porters,
                books.calloway,
                **_line("800.00", "100.00", "74.50", "174.50", "625.50", "78.2"),
            ),
            # Nothing invoiced, so there is a loss and no percentage of anything.
            _contract_line(
                books.repairs,
                books.harbor,
                **_line("0.00", "0.00", "1000.00", "1000.00", "-1000.00", None),
            ),
        ],
        # INV-D, Sam's day at the depot and the 40.25 of supplies name no contract.
        "unattributed": _line("150.75", "150.00", "40.25", "190.25", "-39.50", "-26.2"),
        # The summary's figures for March, to the cent.
        "totals": _line("3450.75", "630.00", "1540.25", "2170.25", "1280.50", "37.1"),
    }


def test_contract_lines_always_come_to_the_summary(books: Books):
    def checked(**narrowing: str) -> dict:
        profitability = _get(books.admin, "contracts", **narrowing, **MARCH)
        summary = _get(books.admin, "summary", **narrowing, **MARCH)
        lines = [*profitability["contracts"], profitability["unattributed"]]
        for figure in ("revenue", "labor_cost", "expense_cost", "operating_cost", "margin"):
            total = sum(Decimal(line[figure]) for line in lines)
            assert total == Decimal(profitability["totals"][figure]), figure
            assert profitability["totals"][figure] == summary[figure]["value"], figure
        assert profitability["totals"]["margin_percent"] == summary["margin_percent"]["value"]
        return profitability

    checked()
    harbor = checked(customer_id=str(books.harbor.id))
    calloway = checked(customer_id=str(books.calloway.id))

    assert [line["contract"]["name"] for line in harbor["contracts"]] == ["Janitorial", "Repairs"]
    # INV-D is Harbor's, and so is Sam's day at Harbor's depot. The supplies that name no
    # building are not: 0.75 is left of 150.75.
    assert harbor["unattributed"] == _line("150.75", "150.00", "0.00", "150.00", "0.75", "0.5")
    assert harbor["totals"] == _line("2650.75", "530.00", "1425.50", "1955.50", "695.25", "26.2")
    assert [line["contract"]["name"] for line in calloway["contracts"]] == ["Porters"]
    assert calloway["unattributed"] == _line("0.00", "0.00", "0.00", "0.00", "0.00", None)


def test_contracts_with_the_same_margin_are_listed_by_number(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    customer = factory.customer(organization)
    for number, total in (("K-30", "500.00"), ("K-10", "500.00"), ("K-20", "900.00")):
        contract = factory.contract(organization, customer, contract_number=number)
        factory.invoice(
            organization,
            customer,
            status=PAID,
            issue_date=_day(3, 10),
            subtotal=_money(total),
            contract_id=contract.id,
        )
    factory.contract(organization, customer, contract_number="K-40")  # nothing in March

    listed = _get(admin, "contracts", **MARCH)["contracts"]

    assert [(line["contract"]["contract_number"], line["margin"]) for line in listed] == [
        ("K-20", "900.00"),
        ("K-10", "500.00"),
        ("K-30", "500.00"),
    ]


# --- buildings ---------------------------------------------------------------------------


def _building_line(building: Building, customer: Customer, **figures: Any) -> dict[str, Any]:
    return {
        "building": {"id": str(building.id), "name": building.name, "code": building.code},
        "customer": {"id": str(customer.id), "name": customer.name, "code": customer.code},
        **figures,
    }


def test_buildings_are_compared_by_what_they_cost_costliest_first(books: Books):
    compared = _get(books.admin, "buildings", **MARCH)

    assert compared == {
        "period": {"start": "2026-03-01", "end": "2026-03-31", "days": 31},
        "as_of": books.today.isoformat(),
        "currency": "USD",
        "buildings": [
            # Sam's six hours and the subcontractor. The job finished there was finished
            # ten minutes into April.
            _building_line(
                books.depot,
                books.harbor,
                labor_cost="150.00",
                expense_cost="1000.00",
                operating_cost="1150.00",
                labor_hours="6.00",
                work_orders_open=1,
                work_orders_completed=0,
            ),
            # Maria's 8 hours, and 8 more with 2 of overtime.
            _building_line(
                books.tower,
                books.harbor,
                labor_cost="380.00",
                expense_cost="425.50",
                operating_cost="805.50",
                labor_hours="18.00",
                work_orders_open=2,
                work_orders_completed=1,
            ),
            _building_line(
                books.plaza,
                books.calloway,
                labor_cost="100.00",
                expense_cost="74.50",
                operating_cost="174.50",
                labor_hours="4.00",
                work_orders_open=1,
                work_orders_completed=1,
            ),
        ],
    }
    # A customer's buildings only.
    calloways = _get(books.admin, "buildings", customer_id=str(books.calloway.id), **MARCH)
    assert [line["building"]["name"] for line in calloways["buildings"]] == ["Granite Plaza"]


def test_a_building_with_no_costs_is_listed_for_the_work_at_it(books: Books):
    # In April nothing was spent at the depot or the plaza, but work is open at both.
    compared = _get(books.admin, "buildings", **{"from": "2026-04-02", "to": "2026-04-30"})

    assert [
        (line["building"]["name"], line["operating_cost"], line["work_orders_open"])
        for line in compared["buildings"]
    ] == [
        # Nothing to tell them apart by cost, so by name.
        ("Granite Plaza", "0.00", 1),
        ("Pier Nine Depot", "0.00", 1),
        ("Tower One", "0.00", 2),
    ]


def test_the_comparison_stops_at_the_fifty_costliest_buildings(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    customer = factory.customer(organization)
    for number in range(1, 53):
        building = factory.building(organization, customer, name=f"Building {number:02d}")
        factory.expense(
            organization,
            building_id=building.id,
            amount=_money(f"{number}.00"),
            incurred_on=_day(3, 10),
            status=APPROVED,
        )

    compared = _get(admin, "buildings", **MARCH)["buildings"]

    assert len(compared) == service.TOP_BUILDINGS == 50
    assert (compared[0]["building"]["name"], compared[0]["operating_cost"]) == (
        "Building 52",
        "52.00",
    )
    # The two cheapest are the ones left out.
    assert (compared[-1]["building"]["name"], compared[-1]["operating_cost"]) == (
        "Building 03",
        "3.00",
    )


# --- work orders -------------------------------------------------------------------------


def _counts(key: str, members: type, **counted: int) -> list[dict[str, Any]]:
    """Every member of an enumeration with its count, in the order they are declared in."""
    return [{key: member.value, "count": counted.get(member.value, 0)} for member in members]


def test_work_orders_are_counted_as_they_stand_today_and_as_they_were_raised(books: Books):
    counted = _get(books.admin, "work-orders", **MARCH)

    assert counted == {
        "period": {"start": "2026-03-01", "end": "2026-03-31", "days": 31},
        "as_of": books.today.isoformat(),
        # All nine, whenever they were raised.
        "by_status": _counts(
            "status",
            WorkOrderStatus,
            open=1,
            scheduled=1,
            in_progress=1,
            on_hold=1,
            completed=4,
            cancelled=1,
        ),
        # Raised in March, New York time: the one raised at 23:30 on the 31st is in, and
        # the one raised at 00:30 on 1 April is not.
        "opened": 5,
        "opened_by_category": _counts("category", WorkOrderCategory, cleaning=2, hvac=2, repair=1),
        "opened_by_priority": _counts("priority", WorkOrderPriority, normal=3, high=2),
    }


def test_work_order_counts_can_be_narrowed(books: Books):
    at_the_tower = _get(books.admin, "work-orders", building_id=str(books.tower.id), **MARCH)
    calloways = _get(books.admin, "work-orders", customer_id=str(books.calloway.id), **MARCH)
    in_february = _get(books.admin, "work-orders", **{"from": "2026-02-01", "to": "2026-02-28"})

    assert at_the_tower["by_status"] == _counts(
        "status", WorkOrderStatus, open=1, scheduled=1, completed=2, cancelled=1
    )
    assert at_the_tower["opened"] == 3
    assert at_the_tower["opened_by_category"] == _counts(
        "category", WorkOrderCategory, cleaning=2, hvac=1
    )
    assert calloways["by_status"] == _counts("status", WorkOrderStatus, on_hold=1, completed=1)
    assert calloways["opened"] == 1
    assert calloways["opened_by_priority"] == _counts("priority", WorkOrderPriority, normal=1)
    # How work stands today does not depend on the period. What was raised does.
    assert in_february["by_status"] == _get(books.admin, "work-orders", **MARCH)["by_status"]
    assert in_february["opened"] == 3
    assert in_february["opened_by_priority"] == _counts(
        "priority", WorkOrderPriority, low=1, normal=1, urgent=1
    )


def test_every_status_is_either_open_or_closed():
    """The dashboard's open work orders and the list's backlog are the same four statuses.
    A new status has to be put on one side or the other."""
    assert set(OPEN_STATUSES) == set(WorkOrderStatus) - {_S.COMPLETED, _S.CANCELLED}


# --- trends ------------------------------------------------------------------------------


def _month_start(day: date, back: int = 0) -> date:
    """The first day of the month `back` months before the one `day` is in."""
    year, month = day.year, day.month - back
    while month < 1:
        year, month = year - 1, month + 12
    return date(year, month, 1)


def _midnight(day: date, zone: ZoneInfo) -> datetime:
    return datetime.combine(day, time.min, zone)


def _trend(month: date, end: date, *, partial: bool = False, **figures: Any) -> dict[str, Any]:
    return {
        "month": month.isoformat(),
        "end": end.isoformat(),
        "is_partial": partial,
        **_line(
            figures.get("revenue", "0.00"),
            figures.get("labor_cost", "0.00"),
            figures.get("expense_cost", "0.00"),
            figures.get("operating_cost", "0.00"),
            figures.get("margin", "0.00"),
            figures.get("margin_percent"),
        ),
        "work_orders_opened": figures.get("opened", 0),
        "work_orders_completed": figures.get("completed", 0),
    }


@dataclass(frozen=True, slots=True)
class Recent:
    """An organization in New York with records in this month and the two before it."""

    admin: Actor
    today: date
    this_month: date
    last_month: date
    two_back: date
    tower: Building
    depot: Building


@pytest.fixture
def recent(make_actor: ActorFactory, factory: Factory) -> Recent:
    admin = make_actor()
    organization = admin.organization
    today = _today(organization)
    this_month, last_month, two_back = (_month_start(today, back) for back in range(3))
    tower = factory.building(organization, name="Tower One")
    depot = factory.building(organization, name="Pier Nine Depot")
    maria = factory.employee(organization)

    # Labor: 160.00 this month; 220.00 and 100.00 last month.
    factory.timesheet(maria, tower, work_date=this_month, status=APPROVED)
    factory.timesheet(
        maria,
        tower,
        work_date=last_month + timedelta(days=14),
        hours_overtime=_money("2.00"),
        status=APPROVED,
    )
    factory.timesheet(
        maria,
        depot,
        work_date=last_month + timedelta(days=9),
        hours_regular=_money("4.00"),
        hourly_rate=_money("25.00"),
        status=APPROVED,
    )
    # Not a cost: pending. And approved, but the day before the three months begin.
    factory.timesheet(maria, tower, work_date=last_month + timedelta(days=15))
    factory.timesheet(maria, tower, work_date=two_back - timedelta(days=1), status=APPROVED)

    # Expenses: 125.00 on the first day of last month, 300.50 on the last day of the
    # month before. One dated tomorrow has not happened yet.
    factory.expense(organization, incurred_on=last_month, status=APPROVED)
    factory.expense(
        organization,
        incurred_on=last_month - timedelta(days=1),
        amount=_money("300.50"),
        status=APPROVED,
    )
    factory.expense(
        organization,
        incurred_on=today + timedelta(days=1),
        amount=_money("60.00"),
        status=APPROVED,
    )

    # Revenue: 1,000.00 this month and 400.00 two months back. A void one in between.
    factory.invoice(organization, status=PAID, issue_date=this_month)
    factory.invoice(
        organization,
        status=ISSUED,
        issue_date=two_back + timedelta(days=9),
        subtotal=_money("400.00"),
    )
    factory.invoice(organization, status=VOID, issue_date=last_month + timedelta(days=4))
    factory.invoice(organization)  # a draft

    # Work orders: one raised two months back and finished as this month began, one raised
    # in the last second of last month, and one raised in the first second of this month.
    factory.work_order(
        organization,
        tower,
        status=_S.COMPLETED,
        created_at=_midnight(two_back + timedelta(days=3), NEW_YORK),
        completed_at=_midnight(this_month, NEW_YORK),
    )
    factory.work_order(
        organization, tower, created_at=_midnight(this_month, NEW_YORK) - timedelta(seconds=1)
    )
    factory.work_order(organization, depot, created_at=_midnight(this_month, NEW_YORK))
    return Recent(admin, today, this_month, last_month, two_back, tower, depot)


def test_trends_run_month_by_month_and_stop_the_one_still_running_at_today(recent: Recent):
    trends = _get(recent.admin, "trends", months=3)

    assert trends == {
        "as_of": recent.today.isoformat(),
        "currency": "USD",
        # Oldest first.
        "months": [
            _trend(
                recent.two_back,
                recent.last_month - timedelta(days=1),
                revenue="400.00",
                expense_cost="300.50",
                operating_cost="300.50",
                margin="99.50",
                margin_percent="24.9",  # 99.50 of 400.00 is 24.875%
                opened=1,
            ),
            _trend(
                recent.last_month,
                recent.this_month - timedelta(days=1),
                labor_cost="320.00",
                expense_cost="125.00",
                operating_cost="445.00",
                margin="-445.00",
                margin_percent=None,  # nothing was invoiced to take a percentage of
                opened=1,
            ),
            # Flagged, and it ends today rather than on the last day of the month.
            _trend(
                recent.this_month,
                recent.today,
                partial=True,
                revenue="1000.00",
                labor_cost="160.00",
                operating_cost="160.00",
                margin="840.00",
                margin_percent="84.0",
                opened=1,
                completed=1,
            ),
        ],
    }


def test_the_month_still_running_is_the_summary_of_the_month_to_date(recent: Recent):
    running = _get(recent.admin, "trends", months=1)["months"][0]
    to_date = _get(
        recent.admin,
        "summary",
        **{"from": recent.this_month.isoformat(), "to": recent.today.isoformat()},
    )

    for figure in ("revenue", "labor_cost", "expense_cost", "operating_cost", "margin"):
        assert running[figure] == to_date[figure]["value"], figure
    assert running["margin_percent"] == to_date["margin_percent"]["value"]
    assert running["work_orders_completed"] == to_date["work_orders_completed"]["value"]
    assert (running["end"], running["is_partial"]) == (recent.today.isoformat(), True)


def test_trends_cover_a_year_unless_told_otherwise_and_months_with_nothing_are_still_there(
    recent: Recent,
):
    months = _get(recent.admin, "trends")["months"]

    assert len(months) == 12
    assert [month["month"] for month in months] == [
        _month_start(recent.today, back).isoformat() for back in range(11, -1, -1)
    ]
    assert [month["is_partial"] for month in months] == [False] * 11 + [True]
    # Eight months in which nothing happened, each one all zeros and ending on its last day.
    for month, following in pairwise(months[:9]):
        last_day = date.fromisoformat(following["month"]) - timedelta(days=1)
        assert month == _trend(date.fromisoformat(month["month"]), last_day)
    # The time approved on the day before the last three months began is in the month it
    # was worked in.
    assert months[8]["labor_cost"] == "160.00"


def test_trends_can_be_narrowed(recent: Recent):
    def labor(**narrowing: str) -> list[str]:
        months = _get(recent.admin, "trends", months=3, **narrowing)["months"]
        return [month["labor_cost"] for month in months]

    at_the_tower = _get(recent.admin, "trends", months=3, building_id=str(recent.tower.id))

    assert labor() == ["0.00", "320.00", "160.00"]
    assert labor(building_id=str(recent.tower.id)) == ["0.00", "220.00", "160.00"]
    assert labor(customer_id=str(recent.depot.customer_id)) == ["0.00", "100.00", "0.00"]
    # No contract covers the tower, so none of the invoices are its.
    assert [month["revenue"] for month in at_the_tower["months"]] == ["0.00", "0.00", "0.00"]
    assert [month["work_orders_opened"] for month in at_the_tower["months"]] == [1, 1, 0]


# --- days and months are the organization's ----------------------------------------------


@pytest.mark.parametrize(
    ("zone", "in_utc"),
    [
        # Thirteen hours ahead of UTC: midnight on 1 March there is still 28 February in UTC.
        ("Pacific/Auckland", "behind"),
        # Eight and then seven hours behind: the last second of 31 March there is 1 April.
        ("America/Los_Angeles", "ahead"),
    ],
)
def test_a_work_order_counts_on_the_day_it_was_where_the_organization_is(
    make_actor: ActorFactory, factory: Factory, zone: str, in_utc: str
):
    organization = factory.organization(timezone=zone)
    admin = make_actor(organization=organization)
    building = factory.building(organization)
    local = ZoneInfo(zone)
    moments = [
        _at(2, 28, "23:59:59", local),
        _at(3, 1, "00:00:00", local),
        _at(3, 31, "23:59:59", local),
        _at(4, 1, "00:00:00", local),
    ]
    # The premise: counted by the day in UTC, these would fall in the wrong months.
    utc_days = [moment.astimezone(ZoneInfo("UTC")).date() for moment in moments]
    assert (
        utc_days
        == {
            "behind": [_day(2, 28), _day(2, 28), _day(3, 31), _day(3, 31)],
            "ahead": [_day(3, 1), _day(3, 1), _day(4, 1), _day(4, 1)],
        }[in_utc]
    )
    for moment in moments:
        factory.work_order(
            organization, building, status=_S.COMPLETED, created_at=moment, completed_at=moment
        )

    def counted(first: str, last: str) -> tuple[int, int]:
        period = {"from": first, "to": last}
        completed = _get(admin, "summary", **period)["work_orders_completed"]["value"]
        return completed, _get(admin, "work-orders", **period)["opened"]

    # Finished, and raised: one in the last second of February, two in March, one in April.
    assert counted("2026-02-01", "2026-02-28") == (1, 1)
    assert counted("2026-03-01", "2026-03-31") == (2, 2)
    assert counted("2026-04-01", "2026-04-30") == (1, 1)
    assert counted("2026-03-01", "2026-03-01") == (1, 1)
    assert counted("2026-03-02", "2026-03-30") == (0, 0)
    compared = _get(admin, "buildings", **MARCH)["buildings"]
    assert [line["work_orders_completed"] for line in compared] == [2]


@pytest.mark.parametrize("zone", ["Pacific/Kiritimati", "Etc/GMT+12"])
def test_a_month_begins_at_midnight_where_the_organization_is(
    make_actor: ActorFactory, factory: Factory, zone: str
):
    organization = factory.organization(timezone=zone)
    admin = make_actor(organization=organization)
    building = factory.building(organization)
    local = ZoneInfo(zone)
    this_month = _month_start(_today(organization))
    # Fourteen hours ahead of UTC or twelve behind it, these two moments are a second
    # apart and in the same month in UTC. Here they are in different months.
    first_second = _midnight(this_month, local)
    last_second = first_second - timedelta(seconds=1)
    assert first_second.astimezone(ZoneInfo("UTC")).month == (
        last_second.astimezone(ZoneInfo("UTC")).month
    )
    for moment in (last_second, first_second):
        factory.work_order(
            organization, building, status=_S.COMPLETED, created_at=moment, completed_at=moment
        )

    last_month, running = _get(admin, "trends", months=2)["months"]

    assert (last_month["work_orders_opened"], last_month["work_orders_completed"]) == (1, 1)
    assert (running["work_orders_opened"], running["work_orders_completed"]) == (1, 1)
    assert running["month"] == this_month.isoformat()


def test_today_is_the_organizations_day(make_actor: ActorFactory, factory: Factory):
    # The two zones are 26 hours apart, so the later one is always at least a day ahead.
    earliest, latest = "Etc/GMT+12", "Pacific/Kiritimati"
    due = datetime.now(ZoneInfo(latest)).date() - timedelta(days=1)
    seen = {}
    for zone in (earliest, latest):
        organization = factory.organization(timezone=zone)
        admin = make_actor(organization=organization)
        factory.invoice(organization, status=ISSUED, issue_date=_day(3, 3), due_date=due)
        factory.work_order(organization, due_on=due)
        summary = _get(admin, "summary", **MARCH)
        assert summary["as_of"] == _today(organization).isoformat()
        assert _get(admin, "trends", months=1)["months"][0]["end"] == summary["as_of"]
        seen[zone] = (
            summary["invoices_outstanding"]["count"],
            summary["invoices_overdue"]["count"],
            summary["work_orders_open"],
            summary["work_orders_overdue"],
        )

    # The same date is yesterday in one place and not yet past in the other.
    assert seen == {earliest: (1, 0, 1, 0), latest: (1, 1, 1, 1)}


# --- an organization with nothing on its books -------------------------------------------


def test_an_organization_with_no_activity_gets_zeros_and_no_percentages(
    make_actor: ActorFactory,
):
    admin = make_actor()
    today = _today(admin.organization)
    nothing = _figure("0.00", "0.00", "0.00", None)
    no_line = _line("0.00", "0.00", "0.00", "0.00", "0.00", None)
    march = {"start": "2026-03-01", "end": "2026-03-31", "days": 31}

    assert _get(admin, "summary", **MARCH) == {
        "period": march,
        "previous_period": {"start": "2026-01-29", "end": "2026-02-28", "days": 31},
        "as_of": today.isoformat(),
        "currency": "USD",
        "scope": {
            "building_id": None,
            "customer_id": None,
            "organization_wide": [],
            "by_contract": [],
        },
        "revenue": nothing,
        "labor_cost": nothing,
        "expense_cost": nothing,
        "operating_cost": nothing,
        "margin": nothing,
        # No revenue to take a percentage of: null, not zero.
        "margin_percent": {"value": None, "previous": None, "change": None},
        "collected": nothing,
        "work_orders_completed": {"value": 0, "previous": 0, "change": 0, "change_percent": None},
        "cost_by_category": _costs(*[("0.00", None)] * 7),
        "invoices_outstanding": {"count": 0, "amount": "0.00"},
        "invoices_overdue": {"count": 0, "amount": "0.00"},
        "work_orders_open": 0,
        "work_orders_overdue": 0,
        "timesheets_pending": {"count": 0, "hours": "0.00"},
        "expenses_pending": {"count": 0, "amount": "0.00"},
        "buildings": {"total": 0, "active": 0},
        "employees": {"total": 0, "active": 0},
        "vendors": {"total": 0, "active": 0},
    }
    assert _get(admin, "contracts", **MARCH) == {
        "period": march,
        "currency": "USD",
        "contracts": [],
        "unattributed": no_line,
        "totals": no_line,
    }
    assert _get(admin, "buildings", **MARCH) == {
        "period": march,
        "as_of": today.isoformat(),
        "currency": "USD",
        "buildings": [],
    }
    assert _get(admin, "work-orders", **MARCH) == {
        "period": march,
        "as_of": today.isoformat(),
        "by_status": _counts("status", WorkOrderStatus),
        "opened": 0,
        "opened_by_category": _counts("category", WorkOrderCategory),
        "opened_by_priority": _counts("priority", WorkOrderPriority),
    }
    trends = _get(admin, "trends", months=2)
    assert [month["is_partial"] for month in trends["months"]] == [False, True]
    for month in trends["months"]:
        assert {key: month[key] for key in no_line} == no_line
        assert (month["work_orders_opened"], month["work_orders_completed"]) == (0, 0)


def test_the_currency_is_the_organizations(make_actor: ActorFactory, factory: Factory):
    admin = make_actor(organization=factory.organization(currency="CAD"))

    for endpoint in ("summary", "contracts", "buildings"):
        assert _get(admin, endpoint, **MARCH)["currency"] == "CAD", endpoint
    assert _get(admin, "trends")["currency"] == "CAD"


# --- one organization's books are its own ------------------------------------------------


def test_another_organization_sees_only_its_own_books(
    books: Books, make_actor: ActorFactory, factory: Factory
):
    stranger = make_actor(organization=_another_organizations_books(factory))

    theirs = _get(stranger, "summary", **MARCH)
    through_our_building = _get(stranger, "summary", building_id=str(books.tower.id), **MARCH)
    through_our_customer = _get(stranger, "summary", customer_id=str(books.harbor.id), **MARCH)

    # One of each, at the factory's amounts.
    assert theirs["labor_cost"]["value"] == "160.00"
    assert theirs["expense_cost"]["value"] == "125.00"
    assert theirs["revenue"]["value"] == "1000.00"
    assert theirs["collected"]["value"] == "100.00"
    assert theirs["invoices_outstanding"] == {"count": 1, "amount": "900.00"}
    assert theirs["invoices_overdue"] == {"count": 1, "amount": "900.00"}
    assert theirs["timesheets_pending"] == {"count": 1, "hours": "8.00"}
    assert theirs["expenses_pending"] == {"count": 1, "amount": "125.00"}
    assert (theirs["work_orders_open"], theirs["work_orders_overdue"]) == (1, 1)
    assert theirs["work_orders_completed"]["value"] == 1
    assert (
        theirs["buildings"]
        == theirs["employees"]
        == theirs["vendors"]
        == {
            "total": 1,
            "active": 1,
        }
    )
    their_contracts = _get(stranger, "contracts", **MARCH)
    assert len(their_contracts["contracts"]) == 1
    assert their_contracts["totals"] == _line(
        "1000.00", "160.00", "125.00", "285.00", "715.00", "71.5"
    )
    assert len(_get(stranger, "buildings", **MARCH)["buildings"]) == 1
    assert _get(stranger, "work-orders", **MARCH)["opened"] == 2
    # Somebody else's building or customer narrows to nothing. It does not open their books.
    for narrowed in (through_our_building, through_our_customer):
        assert narrowed["labor_cost"]["value"] == narrowed["revenue"]["value"] == "0.00"
        assert narrowed["invoices_outstanding"] == {"count": 0, "amount": "0.00"}
        assert narrowed["work_orders_open"] == 0
        assert narrowed["timesheets_pending"]["count"] == 0
        assert narrowed["buildings"] == {"total": 0, "active": 0}
    for endpoint in ("contracts", "buildings"):
        narrowed = _get(stranger, endpoint, customer_id=str(books.harbor.id), **MARCH)
        assert narrowed[endpoint] == [], endpoint
    their_work = _get(stranger, "work-orders", building_id=str(books.tower.id), **MARCH)
    assert their_work["by_status"] == _counts("status", WorkOrderStatus)


def test_every_figure_is_scoped_by_its_own_query_not_only_by_row_level_security(
    books: Books, admin_database: Database
):
    """The same questions, asked on a connection that row-level security does not apply
    to: the owner role's. There, only the conditions in the queries themselves stand
    between the two organizations' books, and the answers must not change."""
    march = {"from": _day(3, 1), "to": _day(3, 31)}
    with admin_database.session() as db:
        ctx = books.admin.service_context(db)
        unguarded = {
            "summary": service.summarize(ctx, SummaryQuery(**march)),
            "trends": service.trends(ctx, TrendsQuery(months=36)),
            "contracts": service.contract_profitability(ctx, ContractsQuery(**march)),
            "buildings": service.building_costs(ctx, BuildingsQuery(**march)),
            "work-orders": service.work_order_counts(ctx, WorkOrdersQuery(**march)),
        }

    for endpoint, answer in unguarded.items():
        params = {"months": 36} if endpoint == "trends" else MARCH
        assert answer.model_dump(mode="json") == _get(books.admin, endpoint, **params), endpoint
    # The other organization does have time this month, which the trends would have added.
    assert unguarded["trends"].months[-1].labor_cost == Decimal("0.00")


# --- how much is asked of the database ---------------------------------------------------


@contextmanager
def _statements(database: Database) -> Iterator[list[str]]:
    """The statements sent to the database while the block runs."""
    seen: list[str] = []

    def record(connection, cursor, statement, parameters, context, executemany) -> None:
        seen.append(statement)

    event.listen(database.engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(database.engine, "before_cursor_execute", record)


def test_each_endpoint_asks_the_database_a_handful_of_questions(
    books: Books, app_database: Database
):
    march = {"from": _day(3, 1), "to": _day(3, 31)}
    questions = {
        "summary": lambda ctx: service.summarize(ctx, SummaryQuery(**march)),
        "trends": lambda ctx: service.trends(ctx, TrendsQuery()),
        "contracts": lambda ctx: service.contract_profitability(ctx, ContractsQuery(**march)),
        "buildings": lambda ctx: service.building_costs(ctx, BuildingsQuery(**march)),
        "work-orders": lambda ctx: service.work_order_counts(ctx, WorkOrdersQuery(**march)),
    }
    asked = {}
    for endpoint, ask in questions.items():
        context = DbContext(organization_id=books.admin.organization.id)
        with app_database.session(context) as db, _statements(app_database) as seen:
            ask(books.admin.service_context(db))
        # Not counting the one that tells row-level security whose transaction this is.
        asked[endpoint] = len([statement for statement in seen if "set_config" not in statement])

    # Each looks the organization up once, for its time zone and currency. Then: the
    # period, the period before it, expenses by category and where things stand today;
    # every month at once; the contracts and their total; the buildings; the work orders
    # as they stand and as they were raised. However many records there are.
    assert asked == {"summary": 5, "trends": 2, "contracts": 3, "buildings": 2, "work-orders": 3}


# --- what can be asked for ---------------------------------------------------------------


def test_a_period_runs_forwards_and_covers_at_most_three_years(make_actor: ActorFactory):
    admin = make_actor()

    def refusal(endpoint: str, **params: Any) -> dict:
        response = admin.get(f"{DASHBOARD}/{endpoint}", params=params)
        assert response.status_code == 422, response.text
        (error,) = problem(response)["errors"]
        return error

    for endpoint in ("summary", "contracts", "buildings", "work-orders"):
        assert refusal(endpoint, **{"from": "2026-03-02", "to": "2026-03-01"}) == {
            "field": "to",
            "message": "The end of the range cannot be before its start (2026-03-02).",
            "code": "invalid_range",
        }
        # Three years to the day, a leap day among them, is the most. One day more is not.
        _get(admin, endpoint, **{"from": "2023-03-01", "to": "2026-02-28"})
        assert refusal(endpoint, **{"from": "2023-03-01", "to": "2026-03-01"}) == {
            "field": "to",
            "message": "Ask for at most 1096 days at a time.",
            "code": "range_too_long",
        }
        assert refusal(endpoint, to="2026-03-31")["field"] == "from"
        assert refusal(endpoint, **{"from": "2026-03-01"})["field"] == "to"
        assert refusal(endpoint, **{"from": "March", "to": "2026-03-31"})["field"] == "from"
        assert refusal(endpoint, **{"from": "2026-02-30", "to": "2026-03-31"})["field"] == "from"
        # Too far back for there to be a period before it to compare with.
        assert refusal(endpoint, **{"from": "0001-01-01", "to": "1900-01-01"})["field"] == "from"
    # A single day is a period.
    _get(admin, "summary", **{"from": "2026-03-01", "to": "2026-03-01"})


def test_trends_cover_between_one_month_and_three_years(make_actor: ActorFactory):
    admin = make_actor()

    assert len(_get(admin, "trends", months=1)["months"]) == 1
    assert len(_get(admin, "trends", months=36)["months"]) == 36
    for months in ("0", "37", "twelve"):
        response = admin.get(f"{DASHBOARD}/trends", params={"months": months})
        assert response.status_code == 422
        assert [error["field"] for error in problem(response)["errors"]] == ["months"]


def test_a_filter_an_endpoint_does_not_take_is_refused_not_ignored(books: Books):
    """Contracts and buildings cannot be narrowed to a building. Ignoring the parameter
    would return every contract while looking as though it had been applied."""
    tower = str(books.tower.id)
    unknown = [
        ("contracts", {**MARCH, "building_id": tower}, "building_id"),
        ("buildings", {**MARCH, "building_id": tower}, "building_id"),
        ("trends", {"from": "2026-03-01"}, "from"),
        ("summary", {**MARCH, "contract_id": tower}, "contract_id"),
        ("work-orders", {**MARCH, "status": "open"}, "status"),
    ]

    for endpoint, params, field in unknown:
        response = books.admin.get(f"{DASHBOARD}/{endpoint}", params=params)
        assert response.status_code == 422, endpoint
        assert problem(response)["errors"] == [
            {"field": field, "message": "Extra inputs are not permitted", "code": "extra_forbidden"}
        ]
    not_an_id = books.admin.get(f"{DASHBOARD}/summary", params={**MARCH, "building_id": "tower"})
    assert not_an_id.status_code == 422
    assert problem(not_an_id)["errors"][0]["field"] == "building_id"


# --- who may see it ----------------------------------------------------------------------


def _params(endpoint: str) -> dict[str, str]:
    """What each endpoint has to be given: a period, except for the trends."""
    return {} if endpoint == "trends" else MARCH


def _statuses(actor: Actor) -> set[int]:
    return {
        actor.get(f"{DASHBOARD}/{endpoint}", params=_params(endpoint)).status_code
        for endpoint in ENDPOINTS
    }


@pytest.mark.parametrize("role", [Role.COMPANY_ADMIN, Role.OPERATIONS_MANAGER])
def test_admins_and_operations_managers_see_the_dashboard(make_actor: ActorFactory, role: Role):
    assert _statuses(make_actor(role)) == {200}


@pytest.mark.parametrize("role", [Role.SUPERVISOR, Role.EMPLOYEE, Role.CUSTOMER, Role.VENDOR])
def test_other_roles_are_refused_the_dashboard(make_actor: ActorFactory, role: Role):
    member = make_actor(role)

    assert _statuses(member) == {403}
    refused = member.get(f"{DASHBOARD}/summary", params=MARCH)
    assert problem(refused)["code"] == "permission_denied"


def test_the_dashboard_needs_a_signed_in_user(client: TestClient):
    for endpoint in ENDPOINTS:
        response = client.get(f"{DASHBOARD}/{endpoint}", params=_params(endpoint))
        assert response.status_code == 401, endpoint


def test_a_platform_admin_sees_the_dashboard_of_the_organization_they_have_entered(
    books: Books, make_actor: ActorFactory
):
    platform_admin = make_actor(platform_admin=True)
    assert _statuses(platform_admin) == {403}  # not inside an organization yet

    platform_admin.post(
        "/api/v1/auth/switch-organization",
        json={"organization_id": str(books.admin.organization.id)},
    )

    assert _statuses(platform_admin) == {200}
    assert _get(platform_admin, "summary", **MARCH) == _get(books.admin, "summary", **MARCH)


# --- periods -----------------------------------------------------------------------------


def test_a_period_counts_both_its_ends_and_is_preceded_by_one_of_the_same_length():
    march = Period(_day(3, 1), _day(3, 31))
    one_day = Period(_day(3, 1), _day(3, 1))
    leap_february = Period(date(2028, 2, 1), date(2028, 2, 29))

    assert (march.days, one_day.days, leap_february.days) == (31, 1, 29)
    assert march.previous() == Period(_day(1, 29), _day(2, 28))
    assert one_day.previous() == Period(_day(2, 28), _day(2, 28))
    assert leap_february.previous() == Period(date(2028, 1, 3), date(2028, 1, 31))
    # Across a year end, and back again: the one before the one before.
    january = Period(_day(1, 1), _day(1, 31))
    assert january.previous() == Period(date(2025, 12, 1), date(2025, 12, 31))
    assert january.previous().previous() == Period(date(2025, 10, 31), date(2025, 11, 30))


def test_months_are_counted_back_from_the_one_still_running():
    assert first_of_month(_day(3, 31)) == _day(3, 1)
    assert first_of_month(_day(3, 31), months_back=3) == date(2025, 12, 1)
    assert first_of_month(_day(1, 1), months_back=12) == date(2025, 1, 1)
    assert last_of_month(_day(2, 10)) == _day(2, 28)
    assert last_of_month(date(2028, 2, 10)) == date(2028, 2, 29)
    assert last_of_month(_day(12, 31)) == _day(12, 31)

    # The month still running stops at today. The others run to their last day.
    assert months_to_date(_day(3, 10), 3) == [
        Period(_day(1, 1), _day(1, 31)),
        Period(_day(2, 1), _day(2, 28)),
        Period(_day(3, 1), _day(3, 10)),
    ]
    assert months_to_date(_day(1, 1), 2) == [
        Period(date(2025, 12, 1), date(2025, 12, 31)),
        Period(_day(1, 1), _day(1, 1)),
    ]
    assert months_to_date(_day(3, 31), 1) == [Period(_day(3, 1), _day(3, 31))]
    assert len(months_to_date(_day(3, 10), 36)) == 36
