"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { ClipboardList, Plus, SearchX } from "lucide-react";
import { useState } from "react";

import { useCan, useMe } from "@/components/me-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Blank, NameCell, StackedCell } from "@/components/ui/cells";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { FilterToggle } from "@/components/ui/filter-toggle";
import { PageHeader, Panel } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState, NoAccess } from "@/components/ui/states";
import { useListParams } from "@/hooks/use-list-params";
import { useBuildingOptions, useEmployeeOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import type { WorkOrder } from "@/lib/api/types";
import { todayInZone } from "@/lib/dates";
import { optionsFrom, personOptions, pick, pickId, recordOptions } from "@/lib/forms";
import { formatDay, formatOverdue } from "@/lib/format";

import { WorkOrderDrawer } from "./work-order-drawer";
import {
  WORK_ORDER_CATEGORIES,
  WORK_ORDER_CATEGORY_LABELS,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_PRIORITY_LABELS,
  WORK_ORDER_PRIORITY_TONES,
} from "./work-order-form-schema";
import { WorkOrderSheet } from "./work-order-sheet";
import {
  BACKLOG_STATUSES,
  viewStatuses,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_STATUS_TONES,
  WORK_ORDER_VIEW_LABELS,
  WORK_ORDER_VIEWS,
  type WorkOrderView,
} from "./work-order-status";

const PAGE_SIZE = 25;
// Which of the list's views is open is not a filter: clearing the filters stays in it.
const VIEW = ["view"] as const;

export function WorkOrdersPage() {
  return useCan("work_orders:read") ? <WorkOrderList /> : <NoAccess what="work orders" />;
}

/** Who has the work: one of our people, a vendor, or both. */
function Assignee({ workOrder }: { workOrder: WorkOrder }) {
  const { assigned_employee: employee, vendor } = workOrder;
  if (employee) return <StackedCell primary={employee.full_name} secondary={vendor?.name} />;
  if (vendor) return <StackedCell primary={vendor.name} secondary="Vendor" />;
  return <span className="whitespace-nowrap text-ink-subtle">Unassigned</span>;
}

/** The due date, with a second line when it has passed or is today. */
function Due({ workOrder, today }: { workOrder: WorkOrder; today: string }) {
  const dueOn = workOrder.due_on;
  if (!dueOn) return <Blank label="No due date" />;
  const dueToday = dueOn === today && BACKLOG_STATUSES.includes(workOrder.status);
  return (
    <StackedCell
      className="min-w-0 whitespace-nowrap"
      primary={<span className="tabular-nums">{formatDay(dueOn)}</span>}
      secondary={
        workOrder.is_overdue ? (
          <span className="font-medium text-critical">{formatOverdue(dueOn, today)}</span>
        ) : dueToday ? (
          <span className="font-medium text-caution">Due today</span>
        ) : null
      }
    />
  );
}

const EMPTY: Record<WorkOrderView, { title: string; description: string }> = {
  backlog: {
    title: "Nothing in the backlog",
    description:
      "Every work order is completed or cancelled. New ones appear here as they are raised.",
  },
  completed: {
    title: "No completed work orders yet",
    description: "Work orders appear here once the work on them is finished.",
  },
  all: {
    title: "No work orders yet",
    description: "Raise a work order for each job to be done at a building.",
  },
};

function WorkOrderList() {
  const me = useMe();
  const canWrite = useCan("work_orders:write");
  const canSeeBuildings = useCan("buildings:read");
  const canSeeEmployees = useCan("employees:read");
  const list = useListParams({ view: VIEW });
  const [viewing, setViewing] = useState<WorkOrder | null>(null);
  const [editing, setEditing] = useState<WorkOrder | "new" | null>(null);

  const view = pick(list.get("view"), WORK_ORDER_VIEWS) ?? "backlog";
  const priority = pick(list.get("priority"), WORK_ORDER_PRIORITIES);
  const category = pick(list.get("category"), WORK_ORDER_CATEGORIES);
  const buildingId = pickId(list.get("building_id"));
  const assigneeId = pickId(list.get("assigned_employee_id"));
  // Finished work is never overdue, so the filter is not offered among completed orders.
  const overdue = view !== "completed" && list.get("overdue") === "true";
  const sort = list.get("sort");
  // A due date passes on a calendar day, where the organization is.
  const today = todayInZone(me.organization?.timezone ?? "UTC");

  const workOrders = $api.useQuery(
    "get",
    "/api/v1/work-orders",
    {
      params: {
        query: {
          q: list.get("q"),
          status: viewStatuses(view),
          priority,
          category,
          building_id: buildingId,
          assigned_employee_id: assigneeId,
          overdue: overdue ? true : undefined,
          sort,
          page: list.page,
          page_size: PAGE_SIZE,
        },
      },
    },
    { placeholderData: keepPreviousData },
  );
  const buildings = useBuildingOptions({ enabled: canSeeBuildings });
  const employees = useEmployeeOptions({ enabled: canSeeEmployees });

  const columns: Column<WorkOrder>[] = [
    {
      id: "work_order",
      header: "Work order",
      sortKey: "number",
      cell: (workOrder) => (
        <NameCell
          name={workOrder.title}
          code={workOrder.number}
          onOpen={() => setViewing(workOrder)}
        />
      ),
    },
    {
      id: "building",
      header: "Building",
      cell: (workOrder) => <StackedCell primary={workOrder.building.name} />,
    },
    {
      id: "category",
      header: "Category",
      cell: (workOrder) => (
        <span className="whitespace-nowrap">{WORK_ORDER_CATEGORY_LABELS[workOrder.category]}</span>
      ),
    },
    {
      id: "priority",
      header: "Priority",
      sortKey: "priority",
      cell: (workOrder) => (
        <Badge tone={WORK_ORDER_PRIORITY_TONES[workOrder.priority]}>
          {WORK_ORDER_PRIORITY_LABELS[workOrder.priority]}
        </Badge>
      ),
    },
    {
      id: "assignee",
      header: "Assigned to",
      cell: (workOrder) => <Assignee workOrder={workOrder} />,
    },
    {
      id: "due",
      header: "Due",
      sortKey: "due_on",
      cell: (workOrder) => <Due workOrder={workOrder} today={today} />,
    },
    {
      id: "status",
      header: "Status",
      sortKey: "status",
      cell: (workOrder) => (
        <Badge dot tone={WORK_ORDER_STATUS_TONES[workOrder.status]}>
          {WORK_ORDER_STATUS_LABELS[workOrder.status]}
        </Badge>
      ),
    },
  ];

  const empty = EMPTY[view];

  return (
    <>
      <PageHeader
        title="Work orders"
        description="The jobs to be done at your buildings: what is waiting, who has it and when it is due."
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus />
              New work order
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="space-y-2.5 border-b border-line p-3">
          <SegmentedControl
            label="Work orders to show"
            value={view}
            segments={WORK_ORDER_VIEWS.map((value) => ({
              value,
              label: WORK_ORDER_VIEW_LABELS[value],
            }))}
            onChange={(next) => list.update({ view: next === "backlog" ? null : next })}
          />
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              label="Search work orders"
              placeholder="Search by number or title"
              value={list.get("q")}
              onChange={(q) => list.update({ q })}
              className="w-full sm:w-64"
            />
            <FilterSelect
              label="Filter by priority"
              placeholder="Any priority"
              value={priority}
              options={optionsFrom(WORK_ORDER_PRIORITY_LABELS)}
              onChange={(value) => list.update({ priority: value })}
              className="w-36"
            />
            <FilterSelect
              label="Filter by category"
              placeholder="All categories"
              value={category}
              options={optionsFrom(WORK_ORDER_CATEGORY_LABELS)}
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
            {canSeeEmployees ? (
              <FilterSelect
                label="Filter by assignee"
                placeholder="Anyone"
                value={assigneeId}
                options={personOptions(employees.data?.items ?? [])}
                onChange={(value) => list.update({ assigned_employee_id: value })}
                className="w-44"
              />
            ) : null}
            {view === "completed" ? null : (
              <FilterToggle
                label="Overdue only"
                checked={overdue}
                onChange={(checked) => list.update({ overdue: checked ? "true" : null })}
              />
            )}
            {list.hasFilters ? (
              <Button variant="ghost" size="sm" onClick={list.clear}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>

        <DataTable
          caption="Work orders"
          columns={columns}
          rows={workOrders.data?.items}
          rowKey={(workOrder) => workOrder.id}
          isLoading={workOrders.isPending}
          isRefreshing={workOrders.isPlaceholderData}
          error={workOrders.error}
          onRetry={() => void workOrders.refetch()}
          sort={sort}
          onSortChange={(next) => list.update({ sort: next })}
          onRowClick={setViewing}
          empty={
            list.hasFilters ? (
              <EmptyState
                icon={SearchX}
                title="No work orders match these filters"
                description="Try a different search, or clear the filters to see every work order in this view."
                action={
                  <Button size="sm" onClick={list.clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={ClipboardList}
                title={empty.title}
                description={empty.description}
                action={
                  canWrite && view !== "completed" ? (
                    <Button size="sm" onClick={() => setEditing("new")}>
                      New work order
                    </Button>
                  ) : null
                }
              />
            )
          }
        />

        {workOrders.data && workOrders.data.total > 0 ? (
          <Pagination
            page={workOrders.data.page}
            pageSize={workOrders.data.page_size}
            total={workOrders.data.total}
            onPageChange={(page) => list.update({ page })}
            noun="work orders"
          />
        ) : null}
      </Panel>

      {/* The drawer steps aside while the work order it shows is being edited. */}
      <WorkOrderDrawer
        workOrder={editing === null ? viewing : null}
        onClose={() => setViewing(null)}
        onEdit={setEditing}
      />
      <WorkOrderSheet
        target={editing}
        defaultBuildingId={buildingId}
        onClose={() => setEditing(null)}
        // What the drawer goes back to showing is the work order as it was saved.
        onSaved={(saved) => setViewing((current) => (current ? saved : current))}
      />
    </>
  );
}
