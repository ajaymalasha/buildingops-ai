"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { ReceiptText, SearchX } from "lucide-react";
import { useState } from "react";

import { useCan, useMe } from "@/components/me-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Blank, NameCell, StackedCell } from "@/components/ui/cells";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { FilterSelect } from "@/components/ui/filter-select";
import { FilterToggle } from "@/components/ui/filter-toggle";
import { PageHeader, Panel } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, NoAccess } from "@/components/ui/states";
import { useListParams } from "@/hooks/use-list-params";
import { useContractOptions, useCustomerOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import type { Invoice } from "@/lib/api/types";
import { todayInZone } from "@/lib/dates";
import { isZero } from "@/lib/decimal";
import {
  contractFilterOptions,
  optionsFrom,
  pick,
  pickDate,
  pickId,
  recordOptions,
} from "@/lib/forms";
import { formatDay, formatMoney, formatOverdue, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  INVOICE_STATUSES,
} from "./invoice-arithmetic";
import { InvoiceDrawer } from "./invoice-drawer";

const PAGE_SIZE = 25;

export function InvoicesPage() {
  return useCan("invoices:read") ? <InvoiceList /> : <NoAccess what="invoices" />;
}

/** The due date, with a second line when it has passed and money is still owed. */
function Due({ invoice, today }: { invoice: Invoice; today: string }) {
  if (!invoice.due_date) return <Blank label="No due date yet" />;
  return (
    <StackedCell
      className="min-w-0 whitespace-nowrap"
      primary={<span className="tabular-nums">{formatDay(invoice.due_date)}</span>}
      secondary={
        invoice.is_overdue ? (
          <span className="font-medium text-critical">
            {formatOverdue(invoice.due_date, today)}
          </span>
        ) : null
      }
    />
  );
}

function InvoiceList() {
  const me = useMe();
  const canSeeCustomers = useCan("customers:read");
  const canSeeContracts = useCan("contracts:read");
  const list = useListParams();
  const [viewing, setViewing] = useState<Invoice | null>(null);

  const status = pick(list.get("status"), INVOICE_STATUSES);
  const customerId = pickId(list.get("customer_id"));
  const contractId = pickId(list.get("contract_id"));
  const overdue = list.get("overdue") === "true";
  const from = pickDate(list.get("from"));
  const to = pickDate(list.get("to"));
  const sort = list.get("sort");
  // An invoice falls due on a calendar day, where the organization is.
  const today = todayInZone(me.organization?.timezone ?? "UTC");

  const invoices = $api.useQuery(
    "get",
    "/api/v1/invoices",
    {
      params: {
        query: {
          status,
          customer_id: customerId,
          contract_id: contractId,
          overdue: overdue ? true : undefined,
          from,
          to,
          sort,
          page: list.page,
          page_size: PAGE_SIZE,
        },
      },
    },
    { placeholderData: keepPreviousData },
  );
  const customers = useCustomerOptions({ enabled: canSeeCustomers });
  const contracts = useContractOptions({ enabled: canSeeContracts });

  const columns: Column<Invoice>[] = [
    {
      id: "invoice",
      header: "Invoice",
      sortKey: "number",
      cell: (invoice) => <NameCell name={invoice.number} onOpen={() => setViewing(invoice)} />,
    },
    {
      id: "customer",
      header: "Customer",
      cell: (invoice) => (
        <StackedCell primary={invoice.customer.name} secondary={invoice.contract?.name} />
      ),
    },
    {
      id: "period",
      header: "Period",
      sortKey: "issue_date",
      cell: (invoice) => (
        <StackedCell
          className="min-w-0 whitespace-nowrap tabular-nums"
          primary={formatPeriod(invoice.period_start, invoice.period_end)}
          secondary={
            invoice.issue_date ? `Issued ${formatDay(invoice.issue_date)}` : "Not issued yet"
          }
        />
      ),
    },
    {
      id: "total",
      header: "Total",
      sortKey: "total",
      align: "end",
      cell: (invoice) => formatMoney(invoice.total, invoice.currency),
    },
    {
      id: "balance_due",
      header: "Balance due",
      sortKey: "balance_due",
      align: "end",
      cell: (invoice) => (
        // What is owed now stands out. Nothing is owed on a draft until it is issued.
        <span
          className={cn(
            (invoice.status !== "issued" || isZero(invoice.balance_due)) && "text-ink-subtle",
          )}
        >
          {formatMoney(invoice.balance_due, invoice.currency)}
        </span>
      ),
    },
    {
      id: "due",
      header: "Due",
      sortKey: "due_date",
      cell: (invoice) => <Due invoice={invoice} today={today} />,
    },
    {
      id: "status",
      header: "Status",
      cell: (invoice) => (
        <Badge dot tone={INVOICE_STATUS_TONES[invoice.status]}>
          {INVOICE_STATUS_LABELS[invoice.status]}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Invoices"
        description="What customers have been billed and what they still owe. Invoices are read-only for now: they cannot be created or changed here, and payments cannot be recorded."
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <FilterSelect
            label="Filter by status"
            placeholder="Any status"
            value={status}
            options={optionsFrom(INVOICE_STATUS_LABELS)}
            onChange={(value) => list.update({ status: value })}
            className="w-36"
          />
          {canSeeCustomers ? (
            <FilterSelect
              label="Filter by customer"
              placeholder="All customers"
              value={customerId}
              options={recordOptions(customers.data?.items ?? [])}
              onChange={(value) => list.update({ customer_id: value })}
              className="w-52"
            />
          ) : null}
          {canSeeContracts ? (
            <FilterSelect
              label="Filter by contract"
              placeholder="All contracts"
              value={contractId}
              options={contractFilterOptions(contracts.data?.items ?? [])}
              onChange={(value) => list.update({ contract_id: value })}
              className="w-56"
            />
          ) : null}
          <DateRangeFilter label="Issued" from={from} to={to} onChange={list.update} />
          <FilterToggle
            label="Overdue only"
            checked={overdue}
            onChange={(checked) => list.update({ overdue: checked ? "true" : null })}
          />
          {list.hasFilters ? (
            <Button variant="ghost" size="sm" onClick={list.clear}>
              Clear filters
            </Button>
          ) : null}
        </div>

        <DataTable
          caption="Invoices"
          columns={columns}
          rows={invoices.data?.items}
          rowKey={(invoice) => invoice.id}
          isLoading={invoices.isPending}
          isRefreshing={invoices.isPlaceholderData}
          error={invoices.error}
          onRetry={() => void invoices.refetch()}
          sort={sort}
          onSortChange={(next) => list.update({ sort: next })}
          onRowClick={setViewing}
          empty={
            list.hasFilters ? (
              <EmptyState
                icon={SearchX}
                title="No invoices match these filters"
                description="Try other filters, or clear them to see every invoice."
                action={
                  <Button size="sm" onClick={list.clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={ReceiptText}
                title="No invoices yet"
                description="Invoices appear here once they exist. They cannot be created in the app yet."
              />
            )
          }
        />

        {invoices.data && invoices.data.total > 0 ? (
          <Pagination
            page={invoices.data.page}
            pageSize={invoices.data.page_size}
            total={invoices.data.total}
            onPageChange={(page) => list.update({ page })}
            noun="invoices"
          />
        ) : null}
      </Panel>

      <InvoiceDrawer invoice={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
