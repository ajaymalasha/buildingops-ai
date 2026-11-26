"""Invoices of the active organization, to read.

Nothing here writes. Invoices are not yet generated from costs and payments are not yet
recorded: what there is to read is history loaded by the seed command.
"""

from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import ColumnElement, Select, and_, func, not_, select

from buildingops.core import crud
from buildingops.core.context import Context
from buildingops.core.errors import NotFoundError
from buildingops.core.pagination import SortKey, apply_sort, between_dates, paginate_rows
from buildingops.modules.contracts.models import Contract
from buildingops.modules.contracts.schemas import ContractRef
from buildingops.modules.customers.models import Customer
from buildingops.modules.customers.schemas import CustomerSummary
from buildingops.modules.identity import organizations_service
from buildingops.modules.invoicing.models import Invoice, InvoiceLine, InvoiceStatus, Payment
from buildingops.modules.invoicing.schemas import (
    InvoiceDetail,
    InvoiceFilters,
    InvoiceLineRead,
    InvoiceRead,
    PaymentRead,
)
from buildingops.modules.sequences.service import CodeSeries

INVOICE_NUMBERS = CodeSeries("invoice", "INV")

_BALANCE_DUE = Invoice.total - Invoice.amount_paid

_SORTABLE: dict[str, SortKey] = {
    # Shorter numbers first, so that INV-10000 comes after INV-9999.
    "number": (func.length(Invoice.number), Invoice.number),
    "issue_date": Invoice.issue_date,
    "due_date": Invoice.due_date,
    "total": Invoice.total,
    "balance_due": _BALANCE_DUE,
}


def _overdue(today: date) -> ColumnElement[bool]:
    """Sent to the customer, not paid in full, and past its due date on `today`. Never
    null, so it can be negated: a draft has no due date and is simply not overdue."""
    return and_(
        Invoice.status == InvoiceStatus.ISSUED,
        _BALANCE_DUE > 0,
        Invoice.due_date.is_not(None),
        Invoice.due_date < today,
    )


def _invoices(ctx: Context, today: date) -> Select[Invoice, Customer, Contract, Decimal, bool]:
    """Each invoice with its customer and contract, what is still owed on it, and whether
    that is overdue. A customer archived since is still shown."""
    return (
        select(
            Invoice,
            Customer,
            Contract,
            _BALANCE_DUE.label("balance_due"),
            _overdue(today).label("is_overdue"),
        )
        .join(Customer, Customer.id == Invoice.customer_id)
        .outerjoin(Contract, Contract.id == Invoice.contract_id)
        .where(crud.live(ctx, Invoice))
    )


def _to_read(
    invoice: Invoice,
    customer: Customer,
    contract: Contract | None,
    balance_due: Decimal,
    is_overdue: bool,
) -> InvoiceRead:
    return InvoiceRead.from_record(
        invoice,
        customer=CustomerSummary.model_validate(customer),
        contract=ContractRef.model_validate(contract) if contract else None,
        balance_due=balance_due,
        is_overdue=is_overdue,
    )


def list_invoices(ctx: Context, filters: InvoiceFilters) -> tuple[list[InvoiceRead], int]:
    today = organizations_service.today(ctx)
    statement = _invoices(ctx, today)
    if filters.status:
        statement = statement.where(Invoice.status == filters.status)
    if filters.customer_id:
        statement = statement.where(Invoice.customer_id == filters.customer_id)
    if filters.contract_id:
        statement = statement.where(Invoice.contract_id == filters.contract_id)
    if filters.overdue is not None:
        statement = statement.where(_overdue(today) if filters.overdue else not_(_overdue(today)))
    statement = between_dates(statement, Invoice.issue_date, filters.from_, filters.to)
    statement = apply_sort(
        statement, filters.sort, allowed=_SORTABLE, default="-number", tiebreaker=Invoice.id
    )
    rows, total = paginate_rows(ctx.db, statement, filters)
    return [_to_read(*row) for row in rows], total


def get_invoice(ctx: Context, invoice_id: UUID) -> InvoiceDetail:
    statement = _invoices(ctx, organizations_service.today(ctx))
    row = ctx.db.execute(statement.where(Invoice.id == invoice_id)).one_or_none()
    if row is None:
        raise NotFoundError("Invoice not found.")
    lines = ctx.db.scalars(
        select(InvoiceLine)
        .where(crud.live(ctx, InvoiceLine), InvoiceLine.invoice_id == invoice_id)
        .order_by(InvoiceLine.position)
    ).all()
    payments = ctx.db.scalars(
        select(Payment)
        .where(crud.live(ctx, Payment), Payment.invoice_id == invoice_id)
        .order_by(Payment.received_on, Payment.id)
    ).all()
    return InvoiceDetail(
        **_to_read(*row).model_dump(),
        lines=[InvoiceLineRead.model_validate(line) for line in lines],
        payments=[PaymentRead.model_validate(payment) for payment in payments],
    )
