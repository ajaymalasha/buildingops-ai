"""Invoices to customers, their lines, and the payments received against them."""

import uuid
from datetime import date
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import CheckConstraint, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from buildingops.core.models import Base, IdMixin, TenantMixin, TimestampMixin, tenant_fk


class InvoiceStatus(StrEnum):
    DRAFT = "draft"
    ISSUED = "issued"
    PAID = "paid"
    VOID = "void"


class InvoiceLineKind(StrEnum):
    LABOR = "labor"
    MATERIALS = "materials"
    EQUIPMENT = "equipment"
    SUBCONTRACTOR = "subcontractor"
    FEE = "fee"
    MARKUP = "markup"
    OTHER = "other"


class PaymentMethod(StrEnum):
    ACH = "ach"
    CHECK = "check"
    CARD = "card"
    WIRE = "wire"
    OTHER = "other"


class Invoice(IdMixin, TimestampMixin, TenantMixin, Base):
    """What a customer is billed for one period, usually under a contract.

    `subtotal` is the cost being billed and `markup_amount` what a cost-plus contract adds
    to it. What is still owed, and whether it is overdue, are worked out when an invoice
    is read rather than stored.
    """

    __tablename__ = "invoices"
    __table_args__ = (
        tenant_fk("customer_id", "customers"),
        tenant_fk("contract_id", "contracts"),
        UniqueConstraint("organization_id", "number"),
        Index(
            "ix_invoices_organization_id_status_due_date", "organization_id", "status", "due_date"
        ),
        Index("ix_invoices_organization_id_customer_id", "organization_id", "customer_id"),
        Index(
            "ix_invoices_organization_id_contract_id_period_start",
            "organization_id",
            "contract_id",
            "period_start",
        ),
        CheckConstraint("period_end >= period_start", name="period_end_not_before_start"),
        CheckConstraint("total = subtotal + markup_amount + tax_amount", name="total_adds_up"),
        CheckConstraint(
            "subtotal >= 0 AND markup_amount >= 0 AND tax_amount >= 0 AND total >= 0",
            name="amounts_not_negative",
        ),
        CheckConstraint(
            "amount_paid >= 0 AND amount_paid <= total", name="amount_paid_within_total"
        ),
    )

    number: Mapped[str] = mapped_column(String(20))
    customer_id: Mapped[uuid.UUID]
    contract_id: Mapped[uuid.UUID | None]
    status: Mapped[InvoiceStatus] = mapped_column(default=InvoiceStatus.DRAFT)
    period_start: Mapped[date]
    period_end: Mapped[date]
    issue_date: Mapped[date | None]
    due_date: Mapped[date | None]
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    markup_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    total: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"))
    currency: Mapped[str] = mapped_column(String(3))
    notes: Mapped[str | None] = mapped_column(Text)


class InvoiceLine(IdMixin, TimestampMixin, TenantMixin, Base):
    __tablename__ = "invoice_lines"
    __table_args__ = (
        tenant_fk("invoice_id", "invoices", ondelete="CASCADE"),
        UniqueConstraint("invoice_id", "position"),
    )

    invoice_id: Mapped[uuid.UUID]
    position: Mapped[int]
    kind: Mapped[InvoiceLineKind]
    description: Mapped[str] = mapped_column(String(300))
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))


class Payment(IdMixin, TimestampMixin, TenantMixin, Base):
    """Money received against one invoice."""

    __tablename__ = "payments"
    __table_args__ = (
        tenant_fk("invoice_id", "invoices"),
        Index("ix_payments_organization_id_received_on", "organization_id", "received_on"),
        CheckConstraint("amount > 0", name="amount_positive"),
    )

    invoice_id: Mapped[uuid.UUID]
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    received_on: Mapped[date]
    method: Mapped[PaymentMethod]
    reference: Mapped[str | None] = mapped_column(String(100))
