"""Invoices for the year, and what customers have paid on them.

One invoice for each active contract and each month in which it has something to bill,
worked out by `billing.py` from the costs the other modules booked. Old ones are paid,
recent ones are out with the customer, a few are overdue, and the current month's are
drafts.
"""

import uuid
from dataclasses import dataclass, field
from datetime import date, time, timedelta
from decimal import Decimal

from buildingops.core.models import new_id
from buildingops.core.money import round_money
from buildingops.modules.contracts.models import BillingModel, Contract
from buildingops.modules.invoicing.models import InvoiceStatus, PaymentMethod
from buildingops.seed.calendar import first_of_month, last_of_month
from buildingops.seed.operations.billing import Bill, Ledger, bill_for_month
from buildingops.seed.operations.setting import Row, Setting

# An invoice goes out a few days after its month ends, and is paid around its due date.
_DAYS_TO_ISSUE = (2, 6)
_DAYS_PAID_AROUND_DUE = (-12, 4)
_PAID_IN_TWO_PARTS = 0.20
_FIRST_PART_SHARES = ("0.40", "0.50", "0.60")
_DAYS_BETWEEN_PARTS = (7, 15)
# Of the invoices that fell due in the last two months, every fourth is still owed, and
# half of those have been paid in part.
_OVERDUE_WINDOW_DAYS = 60
_OVERDUE_EVERY = 4
_OVERDUE_PART_PAID = 0.50
_METHODS = (PaymentMethod.ACH, PaymentMethod.CHECK, PaymentMethod.WIRE, PaymentMethod.CARD)
_METHOD_WEIGHTS = (55, 30, 10, 5)
_NOTHING = Decimal("0.00")


@dataclass(frozen=True, slots=True)
class _Receipt:
    received_on: date
    amount: Decimal
    method: PaymentMethod
    reference: str | None


@dataclass(slots=True)
class _Statement:
    """An invoice on its way to being a row. It has no issue date while it is a draft."""

    contract: Contract
    period_start: date
    period_end: date
    bill: Bill
    issue_date: date | None
    due_date: date | None
    id: uuid.UUID = field(default_factory=new_id)
    receipts: list[_Receipt] = field(default_factory=list)


def build_invoices(setting: Setting, ledger: Ledger) -> tuple[list[Row], list[Row], list[Row]]:
    """The invoices, their lines and the payments on them. The invoices are in the order
    they are to be numbered in, and have no number yet."""
    return _Biller(setting, ledger).build()


class _Biller:
    def __init__(self, setting: Setting, ledger: Ledger) -> None:
        self.setting = setting
        self.ledger = ledger
        self.rng = setting.stream("bill")

    def build(self) -> tuple[list[Row], list[Row], list[Row]]:
        setting = self.setting
        this_month = first_of_month(setting.today)
        statements = []
        for contract in sorted(setting.contracts, key=lambda contract: contract.contract_number):
            month = max(setting.first_day, first_of_month(contract.start_date))
            while month <= this_month:
                statement = self._statement(contract, month)
                if statement is not None:
                    statements.append(statement)
                month = first_of_month(month, months_ago=-1)
        statements.sort(key=lambda s: (s.period_start, s.contract.contract_number))

        issued = [(s, s.issue_date, s.due_date) for s in statements if s.issue_date and s.due_date]
        recently_due = sorted(
            (
                (due_date, statement.contract.contract_number, statement.id)
                for statement, _, due_date in issued
                if 0 < (setting.today - due_date).days <= _OVERDUE_WINDOW_DAYS
            )
        )
        still_owed = {statement_id for _, _, statement_id in recently_due[1::_OVERDUE_EVERY]}
        for statement, issue_date, due_date in issued:
            self._collect(statement, issue_date, due_date, owed=statement.id in still_owed)

        invoices: list[Row] = []
        lines: list[Row] = []
        payments: list[Row] = []
        for statement in statements:
            self._rows(statement, invoices, lines, payments)
        return invoices, lines, payments

    def _statement(self, contract: Contract, month: date) -> _Statement | None:
        """What `contract` bills for the month starting on `month`, if anything.

        The invoice stays a draft until the day it would go out, and for as long as any
        of the costs it bills still wait for a decision. A fixed fee waits for nothing.
        """
        days_to_issue = self.rng.randint(*_DAYS_TO_ISSUE)
        period_start = max(month, contract.start_date)
        period_end = min(last_of_month(month), contract.end_date or date.max)
        bill = bill_for_month(contract, self.ledger.costs(contract, month))
        if period_end < period_start or bill.total == 0:
            return None
        issue_date = period_end + timedelta(days=days_to_issue)
        waits_on_costs = contract.billing_model is not BillingModel.FIXED_FEE and (
            self.ledger.is_waiting(contract, month)
        )
        if issue_date >= self.setting.today or waits_on_costs:
            return _Statement(contract, period_start, period_end, bill, None, None)
        due_date = issue_date + timedelta(days=contract.payment_terms_days)
        return _Statement(contract, period_start, period_end, bill, issue_date, due_date)

    def _collect(
        self, statement: _Statement, issue_date: date, due_date: date, *, owed: bool
    ) -> None:
        """What has been received on an issued invoice by today."""
        rng, total = self.rng, statement.bill.total
        days_around_due = rng.randint(*_DAYS_PAID_AROUND_DUE)
        days_between_parts = rng.randint(*_DAYS_BETWEEN_PARTS)
        first_part = round_money(total * Decimal(rng.choice(_FIRST_PART_SHARES)))
        in_two_parts = rng.random() < _PAID_IN_TWO_PARTS and 0 < first_part < total
        part_paid = rng.random() < _OVERDUE_PART_PAID and 0 < first_part < total
        paid_on = max(due_date + timedelta(days=days_around_due), issue_date)
        earlier = max(min(paid_on, due_date) - timedelta(days=days_between_parts), issue_date)
        if owed:
            # Overdue, and being chased. Some of it has come in on account.
            if part_paid:
                statement.receipts = [self._receipt(earlier, first_part)]
        elif paid_on < self.setting.today:
            if in_two_parts:
                statement.receipts = [
                    self._receipt(earlier, first_part),
                    self._receipt(paid_on, total - first_part),
                ]
            else:
                statement.receipts = [self._receipt(paid_on, total)]

    def _receipt(self, received_on: date, amount: Decimal) -> _Receipt:
        method = self.rng.choices(_METHODS, _METHOD_WEIGHTS)[0]
        number = self.rng.randrange(100_000, 1_000_000)
        # A card payment carries no reference of the customer's.
        reference = None if method is PaymentMethod.CARD else f"{method.value.upper()} {number}"
        return _Receipt(received_on, amount, method, reference)

    def _rows(
        self, statement: _Statement, invoices: list[Row], lines: list[Row], payments: list[Row]
    ) -> None:
        setting, bill, contract = self.setting, statement.bill, statement.contract
        organization_id = setting.organization.id
        paid = sum((receipt.amount for receipt in statement.receipts), _NOTHING)
        if statement.issue_date is None:
            status = InvoiceStatus.DRAFT
        else:
            status = InvoiceStatus.PAID if paid == bill.total else InvoiceStatus.ISSUED
        # Drawn up the morning after the period ends, or as late as there has been.
        drawn_up_at = min(
            setting.local(statement.period_end + timedelta(days=1), time(8, 0)), setting.latest
        )
        received_at = [
            setting.local(receipt.received_on, time(12, 0)) for receipt in statement.receipts
        ]
        invoices.append(
            {
                "id": statement.id,
                "organization_id": organization_id,
                "customer_id": contract.customer_id,
                "contract_id": contract.id,
                "status": status,
                "period_start": statement.period_start,
                "period_end": statement.period_end,
                "issue_date": statement.issue_date,
                "due_date": statement.due_date,
                "subtotal": bill.subtotal,
                "markup_amount": bill.markup_amount,
                "tax_amount": bill.tax_amount,
                "total": bill.total,
                "amount_paid": paid,
                "currency": contract.currency,
                "notes": None,
                "created_at": drawn_up_at,
                "updated_at": max([drawn_up_at, *received_at]),
            }
        )
        lines.extend(
            {
                "id": new_id(),
                "organization_id": organization_id,
                "invoice_id": statement.id,
                "position": position,
                "kind": line.kind,
                "description": line.description,
                "quantity": line.quantity,
                "unit_price": line.unit_price,
                "amount": line.amount,
                "created_at": drawn_up_at,
                "updated_at": drawn_up_at,
            }
            for position, line in enumerate(bill.lines, start=1)
        )
        payments.extend(
            {
                "id": new_id(),
                "organization_id": organization_id,
                "invoice_id": statement.id,
                "amount": receipt.amount,
                "received_on": receipt.received_on,
                "method": receipt.method,
                "reference": receipt.reference,
                "created_at": moment,
                "updated_at": moment,
            }
            for receipt, moment in zip(statement.receipts, received_at, strict=True)
        )
