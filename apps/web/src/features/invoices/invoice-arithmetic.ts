import type { BadgeTone } from "@/components/ui/badge";
import type { InvoiceDetail, InvoiceStatus, PaymentMethod } from "@/lib/api/types";
import { isZero, sameDecimal, sumDecimals } from "@/lib/decimal";

export const INVOICE_STATUSES = ["draft", "issued", "paid", "void"] as const;

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  paid: "Paid",
  void: "Void",
};

export const INVOICE_STATUS_TONES: Record<InvoiceStatus, BadgeTone> = {
  draft: "neutral",
  issued: "info",
  paid: "positive",
  void: "neutral",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  ach: "ACH",
  check: "Check",
  card: "Card",
  wire: "Wire",
  other: "Other",
};

type Billed = Pick<InvoiceDetail, "lines" | "tax_amount" | "total">;
type Collected = Pick<InvoiceDetail, "payments" | "amount_paid">;

export type InvoiceArithmetic = {
  /** What the lines come to, added up exactly. Null if an amount is not a number. */
  linesTotal: string | null;
  /** Whether the invoice carries tax, which is then shown between the lines and the total. */
  hasTax: boolean;
  /** Whether the lines and the tax come to the invoice's total. */
  addsUp: boolean;
  /** What the payments come to, added up exactly. Null if an amount is not a number. */
  paymentsTotal: string | null;
  /** Whether the payments listed come to the amount the invoice records as paid. */
  paymentsAddUp: boolean;
};

/**
 * The sums the drawer shows under an invoice's lines and payments, checked against the
 * totals the API stores.
 *
 * The invoice's totals are the API's, and they are what is shown as the total, the amount
 * paid and the balance. The browser only adds up what is listed, in exact decimal
 * arithmetic, so that the drawer can show the lines coming to the total and say so
 * plainly if they ever do not.
 */
export function invoiceArithmetic(invoice: Billed & Collected): InvoiceArithmetic {
  const linesTotal = sumDecimals(invoice.lines.map((line) => line.amount));
  const withTax = linesTotal === null ? null : sumDecimals([linesTotal, invoice.tax_amount]);
  const paymentsTotal = sumDecimals(invoice.payments.map((payment) => payment.amount));
  return {
    linesTotal,
    hasTax: !isZero(invoice.tax_amount),
    addsUp: withTax !== null && sameDecimal(withTax, invoice.total),
    paymentsTotal,
    paymentsAddUp: paymentsTotal !== null && sameDecimal(paymentsTotal, invoice.amount_paid),
  };
}
