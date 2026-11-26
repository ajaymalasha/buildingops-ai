"""What a contract bills for one month, for the seeded invoices only.

This stands in for the billing engine. Slice 8 replaces it with one that collects approved
costs itself, applies each contract's billing rules, and keeps the trail from every line
back to the records behind it. Until then this is the one place the demo's invoice
arithmetic lives, so that the seeded invoices add up, to the cent, to the seeded costs.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from buildingops.core.models import DecisionStatus
from buildingops.core.money import round_money
from buildingops.modules.contracts.models import BillingModel, Contract
from buildingops.modules.expenses.models import ExpenseCategory
from buildingops.modules.invoicing.models import InvoiceLineKind
from buildingops.seed.calendar import first_of_month

ZERO = Decimal("0.00")
_ONE = Decimal("1.00")

# The contract table has no bill rates yet: billing rules arrive with the billing engine.
# Until then every time-and-materials hour is billed at one rate, and overtime at time
# and a half.
TIME_AND_MATERIALS_RATE = Decimal("42.00")
OVERTIME_RATE = round_money(TIME_AND_MATERIALS_RATE * Decimal("1.5"))

# The invoice line an expense of each category is billed on, and what each line is called.
_LINE_KINDS = {
    ExpenseCategory.MATERIALS: InvoiceLineKind.MATERIALS,
    ExpenseCategory.SUPPLIES: InvoiceLineKind.MATERIALS,
    ExpenseCategory.EQUIPMENT: InvoiceLineKind.EQUIPMENT,
    ExpenseCategory.SUBCONTRACTOR: InvoiceLineKind.SUBCONTRACTOR,
    ExpenseCategory.TRAVEL: InvoiceLineKind.OTHER,
    ExpenseCategory.OTHER: InvoiceLineKind.OTHER,
}
_EXPENSE_LINES = {
    InvoiceLineKind.MATERIALS: "Materials and supplies",
    InvoiceLineKind.EQUIPMENT: "Equipment",
    InvoiceLineKind.SUBCONTRACTOR: "Subcontractors",
    InvoiceLineKind.OTHER: "Other costs",
}


@dataclass(slots=True)
class MonthCosts:
    """What was spent under one contract in one month and can be billed: approved time,
    and expenses that are both approved and billable."""

    hours_regular: Decimal = ZERO
    hours_overtime: Decimal = ZERO
    labor: Decimal = ZERO
    expenses: dict[InvoiceLineKind, Decimal] = field(default_factory=dict)

    def add_time(self, hours_regular: Decimal, hours_overtime: Decimal, cost: Decimal) -> None:
        self.hours_regular += hours_regular
        self.hours_overtime += hours_overtime
        self.labor += cost

    def add_expense(self, category: ExpenseCategory, amount: Decimal) -> None:
        kind = _LINE_KINDS[category]
        self.expenses[kind] = self.expenses.get(kind, ZERO) + amount


class Ledger:
    """What each contract has to bill for each month, kept as the costs are generated.

    Approved time and approved, billable expenses add to the month they fall in. Anything
    billable that still waits for a decision marks its month as waiting, and that
    month's invoice stays a draft.
    """

    def __init__(self) -> None:
        self._costs: defaultdict[tuple[uuid.UUID, date], MonthCosts] = defaultdict(MonthCosts)
        self._waiting: set[tuple[uuid.UUID, date]] = set()

    def book_time(
        self,
        contract: Contract | None,
        day: date,
        status: DecisionStatus,
        hours_regular: Decimal,
        hours_overtime: Decimal,
        cost: Decimal,
    ) -> None:
        if contract is None:
            return
        month = (contract.id, first_of_month(day))
        if status is DecisionStatus.APPROVED:
            self._costs[month].add_time(hours_regular, hours_overtime, cost)
        elif status is DecisionStatus.PENDING:
            self._waiting.add(month)

    def book_expense(
        self,
        contract_id: uuid.UUID | None,
        day: date,
        status: DecisionStatus,
        category: ExpenseCategory,
        amount: Decimal,
        *,
        billable: bool,
    ) -> None:
        if contract_id is None or not billable:
            return
        month = (contract_id, first_of_month(day))
        if status is DecisionStatus.APPROVED:
            self._costs[month].add_expense(category, amount)
        elif status is DecisionStatus.PENDING:
            self._waiting.add(month)

    def costs(self, contract: Contract, month: date) -> MonthCosts:
        return self._costs.get((contract.id, month), MonthCosts())

    def is_waiting(self, contract: Contract, month: date) -> bool:
        return (contract.id, month) in self._waiting


@dataclass(frozen=True, slots=True)
class Line:
    kind: InvoiceLineKind
    description: str
    quantity: Decimal
    unit_price: Decimal
    amount: Decimal


@dataclass(frozen=True, slots=True)
class Bill:
    lines: tuple[Line, ...]
    subtotal: Decimal
    markup_amount: Decimal
    tax_amount: Decimal
    total: Decimal


def bill_for_month(contract: Contract, costs: MonthCosts) -> Bill:
    """The lines and totals of one month's invoice under `contract`.

    Cost-plus bills approved labor and approved billable expenses at cost, and the
    contract's markup on their sum as a line of its own. Fixed-fee bills the monthly fee
    whatever was spent. Time-and-materials bills hours at the rates above and expenses at
    cost. Every line's amount is its quantity times its unit price, rounded half up. Tax
    is left at zero: working out sales tax is the billing engine's job.
    """
    if contract.billing_model is BillingModel.FIXED_FEE:
        fee = _required(contract.monthly_fee, contract, "monthly fee")
        lines = [_line(InvoiceLineKind.FEE, "Monthly service fee", _ONE, fee)]
    elif contract.billing_model is BillingModel.COST_PLUS:
        lines = _at_cost(
            InvoiceLineKind.LABOR, f"Labor: {_hours(costs)} approved hours", costs.labor
        )
        lines += _expense_lines(costs)
    else:
        lines = _hourly("Labor: regular hours", costs.hours_regular, TIME_AND_MATERIALS_RATE)
        lines += _hourly("Labor: overtime hours", costs.hours_overtime, OVERTIME_RATE)
        lines += _expense_lines(costs)

    subtotal = sum((line.amount for line in lines), ZERO)
    markup_amount = ZERO
    if contract.billing_model is BillingModel.COST_PLUS and subtotal > 0:
        percent = _required(contract.markup_percent, contract, "markup")
        markup_amount = round_money(subtotal * percent / 100)
        lines.append(_line(InvoiceLineKind.MARKUP, f"Markup at {percent}%", _ONE, markup_amount))
    return Bill(
        lines=tuple(lines),
        subtotal=subtotal,
        markup_amount=markup_amount,
        tax_amount=ZERO,
        total=subtotal + markup_amount,
    )


def _line(kind: InvoiceLineKind, description: str, quantity: Decimal, unit_price: Decimal) -> Line:
    return Line(kind, description, quantity, unit_price, round_money(quantity * unit_price))


def _at_cost(kind: InvoiceLineKind, description: str, cost: Decimal) -> list[Line]:
    """One line for a cost passed on as it stands, or none if there was no such cost."""
    return [_line(kind, description, _ONE, cost)] if cost > 0 else []


def _hourly(description: str, hours: Decimal, rate: Decimal) -> list[Line]:
    return [_line(InvoiceLineKind.LABOR, description, hours, rate)] if hours > 0 else []


def _expense_lines(costs: MonthCosts) -> list[Line]:
    return [
        line
        for kind, description in _EXPENSE_LINES.items()
        for line in _at_cost(kind, description, costs.expenses.get(kind, ZERO))
    ]


def _hours(costs: MonthCosts) -> str:
    return f"{costs.hours_regular + costs.hours_overtime:,.2f}"


def _required(figure: Decimal | None, contract: Contract, name: str) -> Decimal:
    """The figure a contract's billing model bills from. The table's constraints promise
    it is there, so its absence is a fault in the data, not a case to bill around."""
    if figure is None:
        raise ValueError(f"Contract {contract.contract_number} has no {name}")
    return figure
