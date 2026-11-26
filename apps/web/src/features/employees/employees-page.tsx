"use client";

import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { IdCard, Plus, SearchX } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useCan, useMe } from "@/components/me-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Blank, NameCell, StackedCell } from "@/components/ui/cells";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DropdownMenuItem, DropdownMenuSeparator, RowActions } from "@/components/ui/dropdown-menu";
import { FilterSelect } from "@/components/ui/filter-select";
import { PageHeader, Panel } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState, NoAccess } from "@/components/ui/states";
import { useListParams } from "@/hooks/use-list-params";
import { useBuildingOptions, useJobRoleOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import type { Employee } from "@/lib/api/types";
import { optionsFrom, pick, pickId, recordOptions } from "@/lib/forms";
import { formatDay, formatMoney } from "@/lib/format";

import { EmployeeBuildingsSheet } from "./employee-buildings-sheet";
import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_TONES,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
} from "./employee-form-schema";
import { EmployeeSheet } from "./employee-sheet";

const PAGE_SIZE = 25;

export function EmployeesPage() {
  return useCan("employees:read") ? <EmployeeList /> : <NoAccess what="employees" />;
}

function EmployeeList() {
  const me = useMe();
  const canWrite = useCan("employees:write");
  const canSeePay = useCan("employees:read_compensation");
  const canSeeBuildings = useCan("buildings:read");
  const list = useListParams();
  const [editing, setEditing] = useState<Employee | "new" | null>(null);
  const [assigning, setAssigning] = useState<Employee | null>(null);
  const [archiving, setArchiving] = useState<Employee | null>(null);

  const status = pick(list.get("status"), EMPLOYEE_STATUSES);
  const employmentType = pick(list.get("employment_type"), EMPLOYMENT_TYPES);
  const jobRoleId = pickId(list.get("job_role_id"));
  const buildingId = pickId(list.get("building_id"));
  const sort = list.get("sort");
  const currency = me.organization?.currency ?? "USD";

  const employees = $api.useQuery(
    "get",
    "/api/v1/employees",
    {
      params: {
        query: {
          q: list.get("q"),
          status,
          employment_type: employmentType,
          job_role_id: jobRoleId,
          building_id: buildingId,
          sort,
          page: list.page,
          page_size: PAGE_SIZE,
        },
      },
    },
    { placeholderData: keepPreviousData },
  );
  const jobRoles = useJobRoleOptions();
  const buildings = useBuildingOptions({ enabled: canSeeBuildings });

  const columns: Column<Employee>[] = [
    {
      id: "name",
      header: "Employee",
      sortKey: "name",
      cell: (employee) => <NameCell name={employee.full_name} code={employee.employee_number} />,
    },
    {
      id: "job_role",
      header: "Job role",
      cell: (employee) => <StackedCell primary={employee.job_role.name} />,
    },
    {
      id: "building",
      header: "Primary building",
      cell: (employee) =>
        employee.primary_building ? (
          <StackedCell primary={employee.primary_building.name} />
        ) : (
          <span className="text-ink-subtle">None</span>
        ),
    },
    {
      id: "type",
      header: "Type",
      cell: (employee) => (
        <span className="whitespace-nowrap">
          {EMPLOYMENT_TYPE_LABELS[employee.employment_type]}
        </span>
      ),
    },
  ];

  // Pay is left out, heading and all, for people whose role does not include it.
  if (canSeePay) {
    columns.push({
      id: "rate",
      header: "Hourly rate",
      align: "end",
      cell: (employee) =>
        employee.hourly_rate ? (
          formatMoney(employee.hourly_rate, currency)
        ) : (
          <Blank label="No rate set" />
        ),
    });
  }

  columns.push(
    {
      id: "hired",
      header: "Hired",
      sortKey: "hire_date",
      cell: (employee) =>
        employee.hire_date ? (
          <span className="whitespace-nowrap tabular-nums">{formatDay(employee.hire_date)}</span>
        ) : (
          <Blank label="No hire date" />
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (employee) => (
        <Badge dot tone={EMPLOYEE_STATUS_TONES[employee.status]}>
          {EMPLOYEE_STATUS_LABELS[employee.status]}
        </Badge>
      ),
    },
  );

  if (canWrite) {
    columns.push({
      id: "actions",
      header: "",
      align: "end",
      width: "w-12",
      cell: (employee) => (
        <RowActions label={`Actions for ${employee.full_name}`}>
          <DropdownMenuItem onSelect={() => setEditing(employee)}>Edit employee</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAssigning(employee)}>
            Building assignments
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem tone="danger" onSelect={() => setArchiving(employee)}>
            Archive employee
          </DropdownMenuItem>
        </RowActions>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Employees"
        description="Everyone who works for you, the role each holds and the building they are based at."
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus />
              New employee
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput
            label="Search employees"
            placeholder="Search by name, number or email"
            value={list.get("q")}
            onChange={(q) => list.update({ q })}
            className="w-full sm:w-72"
          />
          <FilterSelect
            label="Filter by job role"
            placeholder="All job roles"
            value={jobRoleId}
            options={recordOptions(jobRoles.data?.items ?? [])}
            onChange={(value) => list.update({ job_role_id: value })}
            className="w-44"
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
          <FilterSelect
            label="Filter by type"
            placeholder="All types"
            value={employmentType}
            options={optionsFrom(EMPLOYMENT_TYPE_LABELS)}
            onChange={(value) => list.update({ employment_type: value })}
            className="w-32"
          />
          <FilterSelect
            label="Filter by status"
            placeholder="Any status"
            value={status}
            options={optionsFrom(EMPLOYEE_STATUS_LABELS)}
            onChange={(value) => list.update({ status: value })}
            className="w-36"
          />
          {list.hasFilters ? (
            <Button variant="ghost" size="sm" onClick={list.clear}>
              Clear filters
            </Button>
          ) : null}
        </div>

        <DataTable
          caption="Employees"
          columns={columns}
          rows={employees.data?.items}
          rowKey={(employee) => employee.id}
          isLoading={employees.isPending}
          isRefreshing={employees.isPlaceholderData}
          error={employees.error}
          onRetry={() => void employees.refetch()}
          sort={sort}
          onSortChange={(next) => list.update({ sort: next })}
          empty={
            list.hasFilters ? (
              <EmptyState
                icon={SearchX}
                title="No employees match these filters"
                description="Try a different search, or clear the filters to see everyone."
                action={
                  <Button size="sm" onClick={list.clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={IdCard}
                title="No employees yet"
                description="Add the people who work for you. Each one holds a job role, so add those first."
                action={
                  canWrite ? (
                    <Button size="sm" onClick={() => setEditing("new")}>
                      New employee
                    </Button>
                  ) : null
                }
              />
            )
          }
        />

        {employees.data && employees.data.total > 0 ? (
          <Pagination
            page={employees.data.page}
            pageSize={employees.data.page_size}
            total={employees.data.total}
            onPageChange={(page) => list.update({ page })}
            noun="employees"
          />
        ) : null}
      </Panel>

      <EmployeeSheet target={editing} onClose={() => setEditing(null)} />
      <EmployeeBuildingsSheet employee={assigning} onClose={() => setAssigning(null)} />
      {archiving ? (
        <ArchiveEmployee employee={archiving} onDone={() => setArchiving(null)} />
      ) : null}
    </>
  );
}

function ArchiveEmployee({ employee, onDone }: { employee: Employee; onDone: () => void }) {
  const queryClient = useQueryClient();
  const archive = $api.useMutation("delete", "/api/v1/employees/{employee_id}", {
    onSuccess: async () => {
      await invalidate(queryClient, "/api/v1/employees", "/api/v1/job-roles");
      toast.success(`${employee.full_name} was archived`);
      onDone();
    },
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onDone()}
      title={`Archive ${employee.full_name}?`}
      description="They leave the employee list and can no longer be assigned to buildings or chosen as a supervisor. Their employee number becomes free to use again, and a sign-in linked to them is unlinked. Archiving cannot be undone from the app."
      confirmLabel="Archive employee"
      tone="danger"
      loading={archive.isPending}
      error={archive.error}
      onConfirm={() => archive.mutate({ params: { path: { employee_id: employee.id } } })}
    />
  );
}
