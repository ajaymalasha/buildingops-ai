"use client";

import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, Plus, SearchX } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useCan, useMe } from "@/components/me-provider";
import { Button } from "@/components/ui/button";
import { Blank } from "@/components/ui/cells";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DropdownMenuItem, DropdownMenuSeparator, RowActions } from "@/components/ui/dropdown-menu";
import { PageHeader, Panel } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState, NoAccess } from "@/components/ui/states";
import { useListParams } from "@/hooks/use-list-params";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import type { JobRole } from "@/lib/api/types";
import { formatMoney, formatNumber } from "@/lib/format";

import { JobRoleDialog } from "./job-role-dialog";

const PAGE_SIZE = 25;

export function JobRolesPage() {
  return useCan("employees:read") ? <JobRoleList /> : <NoAccess what="job roles" />;
}

function JobRoleList() {
  const me = useMe();
  const canWrite = useCan("employees:write");
  const canSeePay = useCan("employees:read_compensation");
  const list = useListParams();
  const [editing, setEditing] = useState<JobRole | "new" | null>(null);
  const [archiving, setArchiving] = useState<JobRole | null>(null);

  const sort = list.get("sort");
  const currency = me.organization?.currency ?? "USD";

  const jobRoles = $api.useQuery(
    "get",
    "/api/v1/job-roles",
    { params: { query: { q: list.get("q"), sort, page: list.page, page_size: PAGE_SIZE } } },
    { placeholderData: keepPreviousData },
  );

  const columns: Column<JobRole>[] = [
    {
      id: "name",
      header: "Job role",
      sortKey: "name",
      cell: (jobRole) => (
        <span className="font-medium whitespace-nowrap text-ink">{jobRole.name}</span>
      ),
    },
    {
      id: "description",
      header: "Description",
      cell: (jobRole) =>
        jobRole.description ? (
          <p className="max-w-md text-ink-muted">{jobRole.description}</p>
        ) : (
          <Blank label="No description" />
        ),
    },
    {
      id: "supervisory",
      header: "Supervisory",
      cell: (jobRole) =>
        jobRole.is_supervisory ? "Yes" : <span className="text-ink-subtle">No</span>,
    },
  ];

  // Pay is left out, heading and all, for people whose role does not include it.
  if (canSeePay) {
    columns.push({
      id: "rate",
      header: "Default rate",
      align: "end",
      cell: (jobRole) =>
        jobRole.default_hourly_rate ? (
          formatMoney(jobRole.default_hourly_rate, currency)
        ) : (
          <Blank label="No default rate" />
        ),
    });
  }

  columns.push({
    id: "employees",
    header: "Employees",
    align: "end",
    cell: (jobRole) =>
      jobRole.employee_count > 0 ? (
        <Link
          href={`/employees?job_role_id=${jobRole.id}`}
          prefetch={false}
          aria-label={`Employees who are ${jobRole.name}: ${jobRole.employee_count}`}
          className="font-medium text-brand-700 hover:text-brand-800 hover:underline"
        >
          {formatNumber(jobRole.employee_count)}
        </Link>
      ) : (
        <span className="text-ink-subtle">0</span>
      ),
  });

  if (canWrite) {
    columns.push({
      id: "actions",
      header: "",
      align: "end",
      width: "w-12",
      cell: (jobRole) => (
        <RowActions label={`Actions for ${jobRole.name}`}>
          <DropdownMenuItem onSelect={() => setEditing(jobRole)}>Edit job role</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem tone="danger" onSelect={() => setArchiving(jobRole)}>
            Archive job role
          </DropdownMenuItem>
        </RowActions>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Job roles"
        description={
          canSeePay
            ? "The positions employees hold, each with the rate a new hire in it starts from."
            : "The positions employees hold, and which of them supervise others."
        }
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus />
              New job role
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput
            label="Search job roles"
            placeholder="Search by name"
            value={list.get("q")}
            onChange={(q) => list.update({ q })}
            className="w-full sm:w-72"
          />
          {list.hasFilters ? (
            <Button variant="ghost" size="sm" onClick={list.clear}>
              Clear filters
            </Button>
          ) : null}
        </div>

        <DataTable
          caption="Job roles"
          columns={columns}
          rows={jobRoles.data?.items}
          rowKey={(jobRole) => jobRole.id}
          isLoading={jobRoles.isPending}
          isRefreshing={jobRoles.isPlaceholderData}
          error={jobRoles.error}
          onRetry={() => void jobRoles.refetch()}
          sort={sort}
          onSortChange={(next) => list.update({ sort: next })}
          empty={
            list.hasFilters ? (
              <EmptyState
                icon={SearchX}
                title="No job roles match this search"
                description="Try a different name, or clear the search to see every role."
                action={
                  <Button size="sm" onClick={list.clear}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={BriefcaseBusiness}
                title="No job roles yet"
                description="Add the positions people are hired into. Every employee holds one."
                action={
                  canWrite ? (
                    <Button size="sm" onClick={() => setEditing("new")}>
                      New job role
                    </Button>
                  ) : null
                }
              />
            )
          }
        />

        {jobRoles.data && jobRoles.data.total > 0 ? (
          <Pagination
            page={jobRoles.data.page}
            pageSize={jobRoles.data.page_size}
            total={jobRoles.data.total}
            onPageChange={(page) => list.update({ page })}
            noun="job roles"
          />
        ) : null}
      </Panel>

      <JobRoleDialog target={editing} onClose={() => setEditing(null)} />
      {archiving ? <ArchiveJobRole jobRole={archiving} onDone={() => setArchiving(null)} /> : null}
    </>
  );
}

function ArchiveJobRole({ jobRole, onDone }: { jobRole: JobRole; onDone: () => void }) {
  const queryClient = useQueryClient();
  const archive = $api.useMutation("delete", "/api/v1/job-roles/{job_role_id}", {
    onSuccess: async () => {
      await invalidate(queryClient, "/api/v1/job-roles");
      toast.success(`${jobRole.name} was archived`);
      onDone();
    },
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onDone()}
      title={`Archive ${jobRole.name}?`}
      description="It leaves the list of job roles and can no longer be given to employees. Archiving cannot be undone from the app."
      confirmLabel="Archive job role"
      tone="danger"
      loading={archive.isPending}
      error={archive.error}
      onConfirm={() => archive.mutate({ params: { path: { job_role_id: jobRole.id } } })}
    />
  );
}
