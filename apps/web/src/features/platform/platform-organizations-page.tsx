"use client";

import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Globe, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useCan, useMe } from "@/components/me-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/input";
import { PageHeader, Panel } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState, NoAccess } from "@/components/ui/states";
import { switchOrganizationAction } from "@/features/auth/actions";
import { useListParams } from "@/hooks/use-list-params";
import { $api } from "@/lib/api/client";
import { problemMessage } from "@/lib/api/problem";
import type { PlatformOrganization } from "@/lib/api/types";
import { pick } from "@/lib/forms";
import { hardNavigate } from "@/lib/hard-navigation";
import { formatDate } from "@/lib/format";

import { CreateOrganizationDialog } from "./create-organization-dialog";

const PAGE_SIZE = 25;
const STATUSES = ["active", "suspended"] as const;

export function PlatformOrganizationsPage() {
  return useCan("platform:organizations") ? (
    <PlatformOrganizations />
  ) : (
    <NoAccess what="platform administration" />
  );
}

function PlatformOrganizations() {
  const me = useMe();
  const list = useListParams();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [entering, startEntering] = useTransition();

  const status = pick(list.get("status"), STATUSES);
  const organizations = $api.useQuery(
    "get",
    "/api/v1/platform/organizations",
    { params: { query: { q: list.get("q"), status, page: list.page, page_size: PAGE_SIZE } } },
    { placeholderData: keepPreviousData },
  );

  const setStatus = $api.useMutation("patch", "/api/v1/platform/organizations/{organization_id}", {
    onSuccess: async (organization) => {
      await queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/platform/organizations"] });
      toast.success(
        organization.status === "active"
          ? `${organization.name} was reactivated`
          : `${organization.name} was suspended`,
      );
    },
    onError: (error) => toast.error(problemMessage(error)),
  });

  function enter(organization: PlatformOrganization) {
    startEntering(async () => {
      const result = await switchOrganizationAction(organization.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      hardNavigate("/");
    });
  }

  const columns: Column<PlatformOrganization>[] = [
    {
      id: "name",
      header: "Organization",
      cell: (organization) => (
        <div>
          <p className="font-medium text-ink">
            {organization.name}
            {organization.id === me.organization?.id ? (
              <Badge tone="brand" className="ml-2">
                Active
              </Badge>
            ) : null}
          </p>
          <p className="font-mono text-[11px] text-ink-subtle">{organization.slug}</p>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (organization) => (
        <Badge dot tone={organization.status === "active" ? "positive" : "caution"}>
          {organization.status === "active" ? "Active" : "Suspended"}
        </Badge>
      ),
    },
    {
      id: "members",
      header: "Members",
      align: "end",
      cell: (organization) => organization.member_count.toLocaleString("en-US"),
    },
    {
      id: "timezone",
      header: "Time zone",
      cell: (organization) => (
        <span className="text-ink-muted">{organization.timezone.replace(/_/g, " ")}</span>
      ),
    },
    {
      id: "created",
      header: "Created",
      cell: (organization) => (
        <span className="text-ink-muted">{formatDate(organization.created_at)}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "end",
      width: "w-12",
      cell: (organization) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${organization.name}`}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-sm text-ink-subtle hover:bg-sunken hover:text-ink data-[state=open]:bg-sunken"
          >
            <Ellipsis className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={entering || organization.id === me.organization?.id}
              onSelect={() => enter(organization)}
            >
              Open this organization
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              tone={organization.status === "active" ? "danger" : "default"}
              onSelect={() =>
                setStatus.mutate({
                  params: { path: { organization_id: organization.id } },
                  body: { status: organization.status === "active" ? "suspended" : "active" },
                })
              }
            >
              {organization.status === "active"
                ? "Suspend organization"
                : "Reactivate organization"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Organizations"
        description="Every organization on the platform. Opening one is recorded in its audit log."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus />
            New organization
          </Button>
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput
            label="Search organizations"
            placeholder="Search by name or identifier"
            value={list.get("q")}
            onChange={(q) => list.update({ q })}
            className="w-full sm:w-72"
          />
          <div className="w-36">
            <Select
              aria-label="Filter by status"
              value={status ?? ""}
              onChange={(event) => list.update({ status: event.target.value })}
            >
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </Select>
          </div>
          {list.hasFilters ? (
            <Button variant="ghost" size="sm" onClick={list.clear}>
              Clear filters
            </Button>
          ) : null}
        </div>

        <DataTable
          caption="Organizations"
          columns={columns}
          rows={organizations.data?.items}
          rowKey={(organization) => organization.id}
          isLoading={organizations.isPending}
          isRefreshing={organizations.isPlaceholderData}
          error={organizations.error}
          onRetry={() => void organizations.refetch()}
          empty={
            <EmptyState
              icon={Globe}
              title={
                list.hasFilters ? "No organizations match these filters" : "No organizations yet"
              }
              description={
                list.hasFilters
                  ? "Try a different search."
                  : "Create the first organization to get started."
              }
            />
          }
        />

        {organizations.data && organizations.data.total > 0 ? (
          <Pagination
            page={organizations.data.page}
            pageSize={organizations.data.page_size}
            total={organizations.data.total}
            onPageChange={(page) => list.update({ page })}
            noun="organizations"
          />
        ) : null}
      </Panel>

      <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
