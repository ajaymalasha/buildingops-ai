"use client";

import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Clock, Plus, SearchX } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useCan, useMe } from "@/components/me-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Blank, NameCell, StackedCell } from "@/components/ui/cells";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { DropdownMenuItem, DropdownMenuSeparator, RowActions } from "@/components/ui/dropdown-menu";
import { FilterSelect } from "@/components/ui/filter-select";
import { FormError } from "@/components/ui/form-error";
import { PageHeader, Panel } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState, NoAccess } from "@/components/ui/states";
import { useListParams } from "@/hooks/use-list-params";
import { useBuildingOptions, useContractOptions, useEmployeeOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import { problemMessage } from "@/lib/api/problem";
import type { Timesheet } from "@/lib/api/types";
import { DECISION_STATUS_LABELS, DECISION_STATUS_TONES } from "@/lib/decisions";
import { isZero } from "@/lib/decimal";
import {
  contractFilterOptions,
  personOptions,
  pick,
  pickDate,
  pickId,
  recordOptions,
} from "@/lib/forms";
import { formatDay, formatHours, formatMoney, formatNumber } from "@/lib/format";
import { keepSelected } from "@/lib/selection";

import { TimesheetDialog } from "./timesheet-dialog";
import {
  isSelectable,
  TIMESHEET_SOURCE_LABELS,
  TIMESHEET_TAB_LABELS,
  TIMESHEET_TABS,
  tabStatus,
  tabTotals,
  totalHours,
  type TimesheetTab,
} from "./timesheet-form-schema";

// An approval queue is worked through a screenful at a time, so its pages are longer.
const PAGE_SIZE = 50;
// Which half of the queue is open is not a filter: clearing the filters stays in it.
const VIEW = ["status"] as const;

export function TimesheetsPage() {
  return useCan("timesheets:read") ? <TimesheetList /> : <NoAccess what="timesheets" />;
}

/** "the timesheet of Ana Zamora for Nov 24, 2026 at Tower One": how a row is named. */
function nameOf(timesheet: Timesheet): string {
  return `the timesheet of ${timesheet.employee.full_name} for ${formatDay(timesheet.work_date)} at ${timesheet.building.name}`;
}

/** What the hours beside the tabs are, for each tab: "412.50 hours waiting for approval". */
const HOURS_ARE: Record<TimesheetTab, string> = {
  pending: "waiting for approval",
  approved: "approved",
  rejected: "rejected",
  all: "in all",
};

const EMPTY: Record<TimesheetTab, { title: string; description: string }> = {
  pending: {
    title: "Nothing is waiting for approval",
    description: "Every timesheet has been decided on. New ones appear here as they are entered.",
  },
  approved: {
    title: "No approved timesheets",
    description: "Timesheets appear here once they are approved.",
  },
  rejected: {
    title: "No rejected timesheets",
    description: "A timesheet that is rejected is kept here with the reason.",
  },
  all: {
    title: "No timesheets yet",
    description: "Enter the time each person worked at a building. It then waits for approval.",
  },
};

function TimesheetList() {
  const me = useMe();
  const canWrite = useCan("timesheets:write");
  const canApprove = useCan("timesheets:approve");
  const canSeePay = useCan("employees:read_compensation");
  const canSeeBuildings = useCan("buildings:read");
  const canSeeEmployees = useCan("employees:read");
  const canSeeContracts = useCan("contracts:read");
  const list = useListParams({ view: VIEW });
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Timesheet | "new" | null>(null);
  const [rejecting, setRejecting] = useState<Timesheet | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  const tab = pick(list.get("status"), TIMESHEET_TABS) ?? "pending";
  const buildingId = pickId(list.get("building_id"));
  const employeeId = pickId(list.get("employee_id"));
  const contractId = pickId(list.get("contract_id"));
  const from = pickDate(list.get("from"));
  const to = pickDate(list.get("to"));
  const sort = list.get("sort");
  const currency = me.organization?.currency ?? "USD";

  const filters = {
    building_id: buildingId,
    employee_id: employeeId,
    contract_id: contractId,
    from,
    to,
  };
  const timesheets = $api.useQuery(
    "get",
    "/api/v1/timesheets",
    {
      params: {
        query: { ...filters, status: tabStatus(tab), sort, page: list.page, page_size: PAGE_SIZE },
      },
    },
    { placeholderData: keepPreviousData },
  );
  // The counts on the tabs are for the same filters, whichever tab is open.
  const summary = $api.useQuery(
    "get",
    "/api/v1/timesheets/summary",
    { params: { query: filters } },
    { placeholderData: keepPreviousData },
  );
  const buildings = useBuildingOptions({ enabled: canSeeBuildings });
  const employees = useEmployeeOptions({ enabled: canSeeEmployees });
  const contracts = useContractOptions({ enabled: canSeeContracts });

  const totals = summary.data ? tabTotals(summary.data) : null;
  const rows = timesheets.data?.items ?? [];
  // What is ticked is only ever what is on screen and can still be approved. A timesheet
  // that left the page, or was decided on meanwhile, drops out without anyone clearing it.
  const selectable = rows.filter(isSelectable);
  const selected = new Set(
    keepSelected(
      ticked,
      selectable.map((timesheet) => timesheet.id),
    ),
  );
  const selectedRows = selectable.filter((timesheet) => selected.has(timesheet.id));

  // A decision moves a timesheet from one tab to another, so the counts change with the list.
  const refresh = () => invalidate(queryClient, "/api/v1/timesheets", "/api/v1/timesheets/summary");
  const onRefused = (error: unknown) => {
    toast.error(problemMessage(error));
  };

  const approve = $api.useMutation("post", "/api/v1/timesheets/{timesheet_id}/approve", {
    onSuccess: async (approved) => {
      await refresh();
      toast.success(
        `${approved.employee.full_name}'s time for ${formatDay(approved.work_date)} was approved`,
      );
    },
    onError: onRefused,
  });

  const reopen = $api.useMutation("post", "/api/v1/timesheets/{timesheet_id}/reopen", {
    onSuccess: async (reopened) => {
      await refresh();
      toast.success(
        `${reopened.employee.full_name}'s time for ${formatDay(reopened.work_date)} is pending again`,
      );
    },
    onError: onRefused,
  });

  const approveSelected = $api.useMutation("post", "/api/v1/timesheets/approve", {
    onSuccess: async ({ approved }) => {
      await refresh();
      setTicked(new Set());
      toast.success(
        approved === 1 ? "1 timesheet was approved" : `${approved} timesheets were approved`,
      );
    },
  });

  const columns: Column<Timesheet>[] = [
    {
      id: "work_date",
      header: "Work date",
      sortKey: "work_date",
      cell: (timesheet) => (
        <span className="whitespace-nowrap tabular-nums">{formatDay(timesheet.work_date)}</span>
      ),
    },
    {
      id: "employee",
      header: "Employee",
      sortKey: "employee",
      cell: (timesheet) => (
        <NameCell name={timesheet.employee.full_name} code={timesheet.employee.employee_number} />
      ),
    },
    {
      id: "building",
      header: "Building",
      cell: (timesheet) => <StackedCell primary={timesheet.building.name} />,
    },
    {
      id: "hours",
      header: "Hours",
      align: "end",
      cell: (timesheet) => (
        <StackedCell
          className="ml-auto min-w-0 whitespace-nowrap"
          primary={formatHours(timesheet.hours_regular)}
          secondary={
            isZero(timesheet.hours_overtime)
              ? null
              : `+ ${formatHours(timesheet.hours_overtime)} overtime`
          }
        />
      ),
    },
  ];

  // What the time cost is left out, heading and all, for people whose role does not include pay.
  if (canSeePay) {
    columns.push({
      id: "cost",
      header: "Cost",
      align: "end",
      cell: (timesheet) =>
        timesheet.labor_cost ? (
          formatMoney(timesheet.labor_cost, currency)
        ) : (
          <Blank label="No cost" />
        ),
    });
  }

  columns.push(
    {
      id: "source",
      header: "Source",
      cell: (timesheet) => (
        <span className="whitespace-nowrap">{TIMESHEET_SOURCE_LABELS[timesheet.source]}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (timesheet) => (
        <div className="max-w-56">
          <Badge dot tone={DECISION_STATUS_TONES[timesheet.status]}>
            {DECISION_STATUS_LABELS[timesheet.status]}
          </Badge>
          {timesheet.rejection_reason ? (
            <p
              className="mt-1 line-clamp-2 text-xs text-ink-muted"
              title={timesheet.rejection_reason}
            >
              {timesheet.rejection_reason}
            </p>
          ) : null}
        </div>
      ),
    },
  );

  if (canApprove || canWrite) {
    columns.push({
      id: "actions",
      header: "",
      align: "end",
      width: "w-12",
      cell: (timesheet) => {
        const pending = timesheet.status === "pending";
        const path = { timesheet_id: timesheet.id };
        // A decided timesheet can only be reopened, and only by someone who decides.
        if (!pending && !canApprove) return null;
        return (
          <RowActions label={`Actions for ${nameOf(timesheet)}`}>
            {pending && canApprove ? (
              <>
                <DropdownMenuItem onSelect={() => approve.mutate({ params: { path } })}>
                  Approve
                </DropdownMenuItem>
                <DropdownMenuItem tone="danger" onSelect={() => setRejecting(timesheet)}>
                  Reject
                </DropdownMenuItem>
              </>
            ) : null}
            {pending && canApprove && canWrite ? <DropdownMenuSeparator /> : null}
            {pending && canWrite ? (
              <DropdownMenuItem onSelect={() => setEditing(timesheet)}>
                Edit timesheet
              </DropdownMenuItem>
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

  const empty = EMPTY[tab];
  const shown = totals?.[tab];

  return (
    <>
      <PageHeader
        title="Timesheets"
        description="The time people worked, building by building, and whether it has been approved."
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus />
              Enter timesheet
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="space-y-2.5 border-b border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <SegmentedControl
              label="Timesheets by status"
              value={tab}
              segments={TIMESHEET_TABS.map((value) => ({
                value,
                label: TIMESHEET_TAB_LABELS[value],
                count: totals?.[value].count,
              }))}
              onChange={(next) => list.update({ status: next === "pending" ? null : next })}
            />
            {shown ? (
              <p className="text-[13px] text-ink-muted tabular-nums" aria-live="polite">
                {formatHours(shown.hours)} hours {HOURS_ARE[tab]}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            {canSeeEmployees ? (
              <FilterSelect
                label="Filter by employee"
                placeholder="All employees"
                value={employeeId}
                options={personOptions(employees.data?.items ?? [])}
                onChange={(value) => list.update({ employee_id: value })}
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
            <DateRangeFilter label="Work date" from={from} to={to} onChange={list.update} />
            {list.hasFilters ? (
              <Button variant="ghost" size="sm" onClick={list.clear}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>

        {selectedRows.length > 0 ? (
          <div
            role="region"
            aria-label="Selected timesheets"
            className="space-y-2.5 border-b border-line bg-brand-50/60 px-4 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-[13px] text-ink tabular-nums" aria-live="polite">
                <span className="font-medium">{formatNumber(selectedRows.length)} selected</span>
                <span className="text-ink-muted">
                  {" · "}
                  {formatHours(totalHours(selectedRows))} hours
                </span>
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  loading={approveSelected.isPending}
                  onClick={() =>
                    approveSelected.mutate({
                      body: { ids: selectedRows.map((timesheet) => timesheet.id) },
                    })
                  }
                >
                  {selectedRows.length === 1
                    ? "Approve 1 timesheet"
                    : `Approve ${formatNumber(selectedRows.length)} timesheets`}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setTicked(new Set());
                    approveSelected.reset();
                  }}
                >
                  Clear selection
                </Button>
              </div>
            </div>
            {approveSelected.error ? (
              <FormError message={problemMessage(approveSelected.error)} />
            ) : null}
          </div>
        ) : null}

        <DataTable
          caption="Timesheets"
          columns={columns}
          rows={timesheets.data?.items}
          rowKey={(timesheet) => timesheet.id}
          isLoading={timesheets.isPending}
          isRefreshing={timesheets.isPlaceholderData}
          error={timesheets.error}
          onRetry={() => void timesheets.refetch()}
          sort={sort}
          onSortChange={(next) => list.update({ sort: next })}
          selection={
            // Only a pending timesheet can be approved, so the other tabs have nothing to tick.
            canApprove && (tab === "pending" || tab === "all")
              ? {
                  selected,
                  onChange: (next) => {
                    setTicked(next);
                    approveSelected.reset();
                  },
                  isSelectable,
                  rowLabel: (timesheet) => `Select ${nameOf(timesheet)}`,
                  allLabel: "Select all pending timesheets on this page",
                }
              : undefined
          }
          empty={
            list.hasFilters ? (
              <EmptyState
                icon={SearchX}
                title="No timesheets match these filters"
                description="Try other filters, or clear them to see every timesheet in this tab."
                action={
                  <Button size="sm" onClick={list.clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Clock}
                title={empty.title}
                description={empty.description}
                action={
                  canWrite && (tab === "pending" || tab === "all") ? (
                    <Button size="sm" onClick={() => setEditing("new")}>
                      Enter timesheet
                    </Button>
                  ) : null
                }
              />
            )
          }
        />

        {timesheets.data && timesheets.data.total > 0 ? (
          <Pagination
            page={timesheets.data.page}
            pageSize={timesheets.data.page_size}
            total={timesheets.data.total}
            onPageChange={(page) => list.update({ page })}
            noun="timesheets"
          />
        ) : null}
      </Panel>

      <TimesheetDialog target={editing} onClose={() => setEditing(null)} />
      {rejecting ? (
        <RejectTimesheet
          timesheet={rejecting}
          onDone={async (rejected) => {
            if (rejected) await refresh();
            setRejecting(null);
          }}
        />
      ) : null}
    </>
  );
}

function RejectTimesheet({
  timesheet,
  onDone,
}: {
  timesheet: Timesheet;
  /** Called when the dialog closes: with true once the timesheet has been rejected. */
  onDone: (rejected: boolean) => Promise<void>;
}) {
  const reject = $api.useMutation("post", "/api/v1/timesheets/{timesheet_id}/reject", {
    onSuccess: async (rejected) => {
      await onDone(true);
      toast.success(
        `${rejected.employee.full_name}'s time for ${formatDay(rejected.work_date)} was rejected`,
      );
    },
  });

  return (
    <ReasonDialog
      open
      onOpenChange={(open) => !open && void onDone(false)}
      title="Reject this timesheet?"
      description={`${timesheet.employee.full_name}, ${formatDay(timesheet.work_date)} at ${timesheet.building.name}: ${formatHours(totalHours([timesheet]))} hours. The reason is kept on the timesheet for whoever entered it.`}
      confirmLabel="Reject timesheet"
      requiredMessage="Say why the timesheet is rejected."
      loading={reject.isPending}
      error={reject.error}
      onConfirm={(reason) =>
        reject.mutate({ params: { path: { timesheet_id: timesheet.id } }, body: { reason } })
      }
    />
  );
}
