"use client";

import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt, SearchX } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useCan } from "@/components/me-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Blank, NameCell, StackedCell } from "@/components/ui/cells";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { DropdownMenuItem, DropdownMenuSeparator, RowActions } from "@/components/ui/dropdown-menu";
import { FilterSelect } from "@/components/ui/filter-select";
import { PageHeader, Panel } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { EmptyState, NoAccess } from "@/components/ui/states";
import { useListParams } from "@/hooks/use-list-params";
import { useBuildingOptions, useContractOptions, useVendorOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import { problemMessage } from "@/lib/api/problem";
import type { Expense } from "@/lib/api/types";
import { DECISION_STATUS_LABELS, DECISION_STATUS_TONES, DECISION_STATUSES } from "@/lib/decisions";
import {
  contractFilterOptions,
  optionsFrom,
  pick,
  pickDate,
  pickId,
  recordOptions,
} from "@/lib/forms";
import { formatDay, formatMoney } from "@/lib/format";

import { bookedTo, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "./expense-form-schema";
import { ExpenseSheet } from "./expense-sheet";

const PAGE_SIZE = 25;

export function ExpensesPage() {
  return useCan("expenses:read") ? <ExpenseList /> : <NoAccess what="expenses" />;
}

/** "Floor finish and stripper ($184.20)": how an expense is named in a sentence. */
function nameOf(expense: Expense): string {
  return `${expense.description} (${formatMoney(expense.amount, expense.currency)})`;
}

function ExpenseList() {
  const canWrite = useCan("expenses:write");
  const canApprove = useCan("expenses:approve");
  const canSeeBuildings = useCan("buildings:read");
  const canSeeContracts = useCan("contracts:read");
  const canSeeVendors = useCan("vendors:read");
  const list = useListParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [rejecting, setRejecting] = useState<Expense | null>(null);

  const status = pick(list.get("status"), DECISION_STATUSES);
  const category = pick(list.get("category"), EXPENSE_CATEGORIES);
  const buildingId = pickId(list.get("building_id"));
  const contractId = pickId(list.get("contract_id"));
  const vendorId = pickId(list.get("vendor_id"));
  const from = pickDate(list.get("from"));
  const to = pickDate(list.get("to"));
  const sort = list.get("sort");

  const expenses = $api.useQuery(
    "get",
    "/api/v1/expenses",
    {
      params: {
        query: {
          status,
          category,
          building_id: buildingId,
          contract_id: contractId,
          vendor_id: vendorId,
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
  const buildings = useBuildingOptions({ enabled: canSeeBuildings });
  const contracts = useContractOptions({ enabled: canSeeContracts });
  const vendors = useVendorOptions({ enabled: canSeeVendors });

  const refresh = () => invalidate(queryClient, "/api/v1/expenses");
  const onRefused = (error: unknown) => {
    toast.error(problemMessage(error));
  };

  const approve = $api.useMutation("post", "/api/v1/expenses/{expense_id}/approve", {
    onSuccess: async (approved) => {
      await refresh();
      toast.success(`${nameOf(approved)} was approved`);
    },
    onError: onRefused,
  });

  const reopen = $api.useMutation("post", "/api/v1/expenses/{expense_id}/reopen", {
    onSuccess: async (reopened) => {
      await refresh();
      toast.success(`${nameOf(reopened)} is pending again`);
    },
    onError: onRefused,
  });

  const columns: Column<Expense>[] = [
    {
      id: "incurred_on",
      header: "Incurred",
      sortKey: "incurred_on",
      cell: (expense) => (
        <span className="whitespace-nowrap tabular-nums">{formatDay(expense.incurred_on)}</span>
      ),
    },
    {
      id: "expense",
      header: "Expense",
      cell: (expense) => (
        <NameCell name={expense.description} code={expense.reference ?? undefined} />
      ),
    },
    {
      id: "category",
      header: "Category",
      cell: (expense) => (
        <span className="whitespace-nowrap">{EXPENSE_CATEGORY_LABELS[expense.category]}</span>
      ),
    },
    {
      id: "building",
      header: "Building",
      cell: (expense) =>
        expense.building ? (
          <StackedCell primary={expense.building.name} secondary={bookedTo(expense)} />
        ) : (
          <Blank label="No building" />
        ),
    },
    {
      id: "vendor",
      header: "Vendor",
      cell: (expense) =>
        expense.vendor ? (
          <StackedCell primary={expense.vendor.name} />
        ) : (
          <Blank label="No vendor" />
        ),
    },
    {
      id: "amount",
      header: "Amount",
      sortKey: "amount",
      align: "end",
      cell: (expense) => (
        <StackedCell
          className="ml-auto min-w-0 whitespace-nowrap"
          primary={formatMoney(expense.amount, expense.currency)}
          secondary={expense.billable ? null : "Not billable"}
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (expense) => (
        <div className="max-w-56">
          <Badge dot tone={DECISION_STATUS_TONES[expense.status]}>
            {DECISION_STATUS_LABELS[expense.status]}
          </Badge>
          {expense.rejection_reason ? (
            <p
              className="mt-1 line-clamp-2 text-xs text-ink-muted"
              title={expense.rejection_reason}
            >
              {expense.rejection_reason}
            </p>
          ) : null}
        </div>
      ),
    },
  ];

  if (canApprove || canWrite) {
    columns.push({
      id: "actions",
      header: "",
      align: "end",
      width: "w-12",
      cell: (expense) => {
        const pending = expense.status === "pending";
        const path = { expense_id: expense.id };
        // A decided expense can only be reopened, and only by someone who decides.
        if (!pending && !canApprove) return null;
        return (
          <RowActions label={`Actions for ${nameOf(expense)}`}>
            {pending && canApprove ? (
              <>
                <DropdownMenuItem onSelect={() => approve.mutate({ params: { path } })}>
                  Approve
                </DropdownMenuItem>
                <DropdownMenuItem tone="danger" onSelect={() => setRejecting(expense)}>
                  Reject
                </DropdownMenuItem>
              </>
            ) : null}
            {pending && canApprove && canWrite ? <DropdownMenuSeparator /> : null}
            {pending && canWrite ? (
              <DropdownMenuItem onSelect={() => setEditing(expense)}>Edit expense</DropdownMenuItem>
            ) : null}
            {!pending ? (
              <DropdownMenuItem onSelect={() => reopen.mutate({ params: { path } })}>
                Reopen
              </DropdownMenuItem>
            ) : null}
          </RowActions>
        );
      },
    });
  }

  return (
    <>
      <PageHeader
        title="Expenses"
        description="What was bought or paid for, which building and contract it was for, and whether it has been approved."
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus />
              New expense
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <FilterSelect
            label="Filter by status"
            placeholder="Any status"
            value={status}
            options={optionsFrom(DECISION_STATUS_LABELS)}
            onChange={(value) => list.update({ status: value })}
            className="w-36"
          />
          <FilterSelect
            label="Filter by category"
            placeholder="All categories"
            value={category}
            options={optionsFrom(EXPENSE_CATEGORY_LABELS)}
            onChange={(value) => list.update({ category: value })}
            className="w-40"
          />
          {canSeeBuildings ? (
            <FilterSelect
              label="Filter by building"
              placeholder="All buildings"
              value={buildingId}
              options={recordOptions(buildings.data?.items ?? [])}
              onChange={(value) => list.update({ building_id: value })}
              className="w-48"
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
          {canSeeVendors ? (
            <FilterSelect
              label="Filter by vendor"
              placeholder="All vendors"
              value={vendorId}
              options={recordOptions(vendors.data?.items ?? [])}
              onChange={(value) => list.update({ vendor_id: value })}
              className="w-48"
            />
          ) : null}
          <DateRangeFilter label="Incurred" from={from} to={to} onChange={list.update} />
          {list.hasFilters ? (
            <Button variant="ghost" size="sm" onClick={list.clear}>
              Clear filters
            </Button>
          ) : null}
        </div>

        <DataTable
          caption="Expenses"
          columns={columns}
          rows={expenses.data?.items}
          rowKey={(expense) => expense.id}
          isLoading={expenses.isPending}
          isRefreshing={expenses.isPlaceholderData}
          error={expenses.error}
          onRetry={() => void expenses.refetch()}
          sort={sort}
          onSortChange={(next) => list.update({ sort: next })}
          empty={
            list.hasFilters ? (
              <EmptyState
                icon={SearchX}
                title="No expenses match these filters"
                description="Try other filters, or clear them to see every expense."
                action={
                  <Button size="sm" onClick={list.clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Receipt}
                title="No expenses yet"
                description="Enter what is bought or paid for as it happens. Each expense waits for approval."
                action={
                  canWrite ? (
                    <Button size="sm" onClick={() => setEditing("new")}>
                      New expense
                    </Button>
                  ) : null
                }
              />
            )
          }
        />

        {expenses.data && expenses.data.total > 0 ? (
          <Pagination
            page={expenses.data.page}
            pageSize={expenses.data.page_size}
            total={expenses.data.total}
            onPageChange={(page) => list.update({ page })}
            noun="expenses"
          />
        ) : null}
      </Panel>

      <ExpenseSheet target={editing} onClose={() => setEditing(null)} />
      {rejecting ? (
        <RejectExpense
          expense={rejecting}
          onDone={async (rejected) => {
            if (rejected) await refresh();
            setRejecting(null);
          }}
        />
      ) : null}
    </>
  );
}

function RejectExpense({
  expense,
  onDone,
}: {
  expense: Expense;
  /** Called when the dialog closes: with true once the expense has been rejected. */
  onDone: (rejected: boolean) => Promise<void>;
}) {
  const reject = $api.useMutation("post", "/api/v1/expenses/{expense_id}/reject", {
    onSuccess: async (rejected) => {
      await onDone(true);
      toast.success(`${nameOf(rejected)} was rejected`);
    },
  });

  return (
    <ReasonDialog
      open
      onOpenChange={(open) => !open && void onDone(false)}
      title="Reject this expense?"
      description={`${nameOf(expense)}, incurred ${formatDay(expense.incurred_on)}. The reason is kept on the expense for whoever entered it.`}
      confirmLabel="Reject expense"
      requiredMessage="Say why the expense is rejected."
      loading={reject.isPending}
      error={reject.error}
      onConfirm={(reason) =>
        reject.mutate({ params: { path: { expense_id: expense.id } }, body: { reason } })
      }
    />
  );
}
