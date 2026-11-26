"use client";

import { useMe } from "@/components/me-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Blank } from "@/components/ui/cells";
import { Detail, DetailList } from "@/components/ui/detail-list";
import { FormError } from "@/components/ui/form-error";
import { Sheet, SheetBody, SheetClose, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { $api } from "@/lib/api/client";
import { problemMessage } from "@/lib/api/problem";
import type { Invoice, InvoiceDetail } from "@/lib/api/types";
import { todayInZone } from "@/lib/dates";
import { formatDay, formatMoney, formatOverdue, formatPeriod, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  invoiceArithmetic,
  PAYMENT_METHOD_LABELS,
} from "./invoice-arithmetic";

type Props = {
  /** The invoice to show, as the list has it, or null while closed. */
  invoice: Invoice | null;
  onClose: () => void;
};

/**
 * An invoice, opened from the list: who it is to, what it bills line by line, and what has
 * been paid on it. There is nothing to change here. Invoices are not yet generated or
 * edited in the app, and payments are not yet recorded in it.
 */
export function InvoiceDrawer({ invoice, onClose }: Props) {
  return (
    <Sheet open={invoice !== null} onOpenChange={(open) => !open && onClose()}>
      {invoice ? (
        <SheetContent
          reading
          title={`Invoice ${invoice.number}`}
          description={`${invoice.customer.name} · ${formatPeriod(invoice.period_start, invoice.period_end)}`}
        >
          <InvoiceView listed={invoice} />
          <SheetFooter>
            <SheetClose asChild>
              <Button>Done</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function InvoiceView({ listed }: { listed: Invoice }) {
  const me = useMe();
  const today = todayInZone(me.organization?.timezone ?? "UTC");
  const detail = $api.useQuery("get", "/api/v1/invoices/{invoice_id}", {
    params: { path: { invoice_id: listed.id } },
  });
  // The list's row has everything but the lines and the payments.
  const invoice: Invoice = detail.data ?? listed;
  const money = (amount: string) => formatMoney(amount, invoice.currency);

  return (
    <SheetBody className="space-y-7">
      <section aria-labelledby="invoice-details" className="space-y-3">
        <h3 id="invoice-details" className="sr-only">
          Details
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge dot tone={INVOICE_STATUS_TONES[invoice.status]}>
            {INVOICE_STATUS_LABELS[invoice.status]}
          </Badge>
          {invoice.is_overdue && invoice.due_date ? (
            <span className="text-xs font-medium text-critical">
              {formatOverdue(invoice.due_date, today)}
            </span>
          ) : null}
        </div>
        <DetailList>
          <Detail term="Customer">{invoice.customer.name}</Detail>
          <Detail term="Contract">
            {invoice.contract ? (
              `${invoice.contract.contract_number} · ${invoice.contract.name}`
            ) : (
              <Blank label="No contract" />
            )}
          </Detail>
          <Detail term="Billing period">
            <span className="tabular-nums">
              {formatPeriod(invoice.period_start, invoice.period_end)}
            </span>
          </Detail>
          <Detail term="Issued">
            {invoice.issue_date ? (
              <span className="tabular-nums">{formatDay(invoice.issue_date)}</span>
            ) : (
              <span className="text-ink-subtle">Not issued yet</span>
            )}
          </Detail>
          <Detail term="Due">
            {invoice.due_date ? (
              <span className="tabular-nums">{formatDay(invoice.due_date)}</span>
            ) : (
              <Blank label="No due date" />
            )}
          </Detail>
          <Detail term="Balance due">
            <span className="font-medium tabular-nums">{money(invoice.balance_due)}</span>
          </Detail>
        </DetailList>
      </section>

      {detail.data ? (
        <Breakdown invoice={detail.data} money={money} />
      ) : detail.error ? (
        <ErrorState
          className="py-8"
          message={problemMessage(detail.error)}
          onRetry={() => void detail.refetch()}
        />
      ) : (
        <div role="status" aria-label="Loading the lines and payments" className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-4 w-full" />
          ))}
        </div>
      )}

      {invoice.notes ? (
        <section aria-labelledby="invoice-notes" className="space-y-2">
          <h3 id="invoice-notes" className="eyebrow">
            Notes
          </h3>
          <p className="text-[13px] whitespace-pre-line text-ink">{invoice.notes}</p>
        </section>
      ) : null}
    </SheetBody>
  );
}

const heading = "h-8 px-0 text-xs font-medium whitespace-nowrap text-ink-muted";
const figure = "py-2 pl-4 text-right whitespace-nowrap tabular-nums";

/** A row under a table's body: what the figures above it come to. */
function Sum({
  label,
  amount,
  span,
  strong = false,
}: {
  label: string;
  amount: string;
  /** How many columns the label runs across, so that the figure sits under the amounts. */
  span: number;
  strong?: boolean;
}) {
  return (
    <tr>
      <th
        scope="row"
        colSpan={span}
        className={cn("py-2 text-left", strong ? "font-semibold" : "font-normal text-ink-muted")}
      >
        {label}
      </th>
      <td className={cn(figure, strong && "font-semibold")}>{amount}</td>
    </tr>
  );
}

function Breakdown({
  invoice,
  money,
}: {
  invoice: InvoiceDetail;
  money: (amount: string) => string;
}) {
  const sums = invoiceArithmetic(invoice);
  return (
    <>
      <section aria-labelledby="invoice-lines" className="space-y-2">
        <h3 id="invoice-lines" className="eyebrow">
          Lines
        </h3>
        {invoice.lines.length === 0 ? (
          <p className="text-[13px] text-ink-muted">This invoice has no lines.</p>
        ) : (
          <table aria-labelledby="invoice-lines" className="w-full text-[13px] text-ink">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={cn(heading, "text-left")}>
                  Description
                </th>
                <th scope="col" className={cn(heading, "pl-4 text-right")}>
                  Quantity
                </th>
                <th scope="col" className={cn(heading, "pl-4 text-right")}>
                  Unit price
                </th>
                <th scope="col" className={cn(heading, "pl-4 text-right")}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invoice.lines.map((line) => (
                <tr key={line.id}>
                  <td className="py-2">{line.description}</td>
                  <td className={figure}>{formatQuantity(line.quantity)}</td>
                  <td className={figure}>{money(line.unit_price)}</td>
                  <td className={figure}>{money(line.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line-strong">
              {sums.hasTax && sums.linesTotal ? (
                <>
                  <Sum label="Lines" amount={money(sums.linesTotal)} span={3} />
                  <Sum label="Tax" amount={money(invoice.tax_amount)} span={3} />
                </>
              ) : null}
              <Sum label="Total" amount={money(invoice.total)} span={3} strong />
            </tfoot>
          </table>
        )}
        {invoice.lines.length > 0 && !sums.addsUp ? (
          <FormError
            message={
              sums.linesTotal
                ? `These lines come to ${money(sums.linesTotal)}${sums.hasTax ? " before tax" : ""}, which does not match the invoice total of ${money(invoice.total)}.`
                : "The amounts on these lines could not be added up."
            }
          />
        ) : null}
      </section>

      <section aria-labelledby="invoice-payments" className="space-y-2">
        <h3 id="invoice-payments" className="eyebrow">
          Payments received
        </h3>
        {invoice.payments.length === 0 ? (
          <p className="text-[13px] text-ink-muted">
            {invoice.status === "draft"
              ? "This invoice has not been issued, so nothing has been paid on it."
              : "Nothing has been received on this invoice yet."}
          </p>
        ) : (
          <table aria-labelledby="invoice-payments" className="w-full text-[13px] text-ink">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={cn(heading, "text-left")}>
                  Received
                </th>
                <th scope="col" className={cn(heading, "pl-4 text-left")}>
                  Method
                </th>
                <th scope="col" className={cn(heading, "pl-4 text-left")}>
                  Reference
                </th>
                <th scope="col" className={cn(heading, "pl-4 text-right")}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invoice.payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="py-2 whitespace-nowrap tabular-nums">
                    {formatDay(payment.received_on)}
                  </td>
                  <td className="py-2 pl-4">{PAYMENT_METHOD_LABELS[payment.method]}</td>
                  <td className="py-2 pl-4">
                    {payment.reference ? (
                      <span className="font-mono text-xs">{payment.reference}</span>
                    ) : (
                      <Blank label="No reference" />
                    )}
                  </td>
                  <td className={figure}>{money(payment.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line-strong">
              <Sum label="Paid" amount={money(invoice.amount_paid)} span={3} />
              <Sum label="Balance due" amount={money(invoice.balance_due)} span={3} strong />
            </tfoot>
          </table>
        )}
        {invoice.payments.length > 0 && !sums.paymentsAddUp ? (
          <FormError
            message={
              sums.paymentsTotal
                ? `These payments come to ${money(sums.paymentsTotal)}, which does not match the ${money(invoice.amount_paid)} recorded as paid.`
                : "The amounts of these payments could not be added up."
            }
          />
        ) : null}
      </section>
    </>
  );
}
