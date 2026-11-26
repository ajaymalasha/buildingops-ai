from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import Field

from buildingops.core.pagination import PageParams
from buildingops.core.schemas import ResponseModel
from buildingops.modules.contracts.schemas import ContractRef
from buildingops.modules.customers.schemas import CustomerSummary
from buildingops.modules.invoicing.models import InvoiceLineKind, InvoiceStatus, PaymentMethod


class InvoiceLineRead(ResponseModel):
    id: UUID
    position: int
    kind: InvoiceLineKind
    description: str
    quantity: Decimal
    unit_price: Decimal
    amount: Decimal


class PaymentRead(ResponseModel):
    id: UUID
    amount: Decimal
    received_on: date
    method: PaymentMethod
    reference: str | None


class InvoiceRead(ResponseModel):
    id: UUID
    number: str
    customer: CustomerSummary
    contract: ContractRef | None
    status: InvoiceStatus
    period_start: date
    period_end: date
    issue_date: date | None = Field(description="Null while the invoice is a draft.")
    due_date: date | None
    subtotal: Decimal = Field(description="The cost billed, before markup and tax.")
    markup_amount: Decimal
    tax_amount: Decimal
    total: Decimal
    amount_paid: Decimal
    balance_due: Decimal = Field(description="The total less what has been paid.")
    is_overdue: bool = Field(
        description=(
            "Issued, with a balance due, and due before today in the organization's time zone."
        )
    )
    currency: str
    notes: str | None
    created_at: datetime
    updated_at: datetime


class InvoiceDetail(InvoiceRead):
    lines: list[InvoiceLineRead] = Field(description="In the order they appear on the invoice.")
    payments: list[PaymentRead] = Field(description="Oldest first.")


class InvoiceFilters(PageParams):
    status: InvoiceStatus | None = None
    customer_id: UUID | None = None
    contract_id: UUID | None = None
    overdue: bool | None = Field(
        default=None,
        description=(
            "True for issued invoices with a balance past its due date, false for the rest."
        ),
    )
    from_: date | None = Field(
        default=None, alias="from", description="Issued on or after this day."
    )
    to: date | None = Field(default=None, description="Issued on or before this day.")
    sort: str | None = Field(
        default=None,
        description=(
            "One of number, issue_date, due_date, total, balance_due. Prefix with - to reverse."
            " Latest number first when omitted."
        ),
    )
