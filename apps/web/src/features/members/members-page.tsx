"use client";

import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Plus, UserRoundX, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useCan, useMe } from "@/components/me-provider";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DropdownMenuItem, DropdownMenuSeparator, RowActions } from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/input";
import { PageHeader, Panel } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState, NoAccess } from "@/components/ui/states";
import { useListParams } from "@/hooks/use-list-params";
import { $api } from "@/lib/api/client";
import { problemMessage } from "@/lib/api/problem";
import type { Member } from "@/lib/api/types";
import { pick } from "@/lib/forms";
import { formatDateTime, formatRelative } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/permissions";

import { AddMemberDialog } from "./add-member-dialog";
import { EditMemberDialog } from "./edit-member-dialog";
import { ROLE_OPTIONS, STATUS_OPTIONS } from "./member-form-schema";

const PAGE_SIZE = 25;

export function MembersPage() {
  return useCan("members:read") ? <MembersList /> : <NoAccess what="the member list" />;
}

function MembersList() {
  const me = useMe();
  const canManage = useCan("members:manage");
  const list = useListParams();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);

  const role = pick(list.get("role"), ROLE_OPTIONS);
  const status = pick(list.get("status"), STATUS_OPTIONS);
  const sort = list.get("sort");

  const members = $api.useQuery(
    "get",
    "/api/v1/members",
    {
      params: {
        query: { q: list.get("q"), role, status, sort, page: list.page, page_size: PAGE_SIZE },
      },
    },
    { placeholderData: keepPreviousData },
  );

  const setAccess = $api.useMutation("patch", "/api/v1/members/{member_id}", {
    onSuccess: async (member) => {
      await queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/members"] });
      toast.success(
        member.status === "active"
          ? `${member.full_name}'s access was restored`
          : `${member.full_name}'s access was suspended`,
      );
    },
    onError: (error) => toast.error(problemMessage(error)),
  });

  const timeZone = me.organization?.timezone;

  const columns: Column<Member>[] = [
    {
      id: "name",
      header: "Name",
      sortKey: "name",
      cell: (member) => (
        <div className="flex items-center gap-3">
          <Avatar name={member.full_name} />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">
              {member.full_name}
              {member.user_id === me.user.id ? (
                <span className="font-normal text-ink-subtle"> (you)</span>
              ) : null}
            </p>
            <p className="truncate text-xs text-ink-muted">{member.email}</p>
          </div>
        </div>
      ),
    },
    {
      id: "role",
      header: "Role",
      sortKey: "role",
      cell: (member) => (
        <Badge tone={member.role === "company_admin" ? "brand" : "neutral"}>
          {ROLE_LABELS[member.role]}
        </Badge>
      ),
    },
    {
      id: "title",
      header: "Job title",
      cell: (member) => member.title ?? <span className="text-ink-subtle">—</span>,
    },
    {
      id: "status",
      header: "Access",
      cell: (member) => (
        <Badge dot tone={member.status === "active" ? "positive" : "neutral"}>
          {member.status === "active" ? "Active" : "Suspended"}
        </Badge>
      ),
    },
    {
      id: "last_login",
      header: "Last sign-in",
      cell: (member) =>
        member.last_login_at ? (
          <span title={formatDateTime(member.last_login_at, timeZone)} className="text-ink-muted">
            {formatRelative(member.last_login_at)}
          </span>
        ) : (
          <span className="text-ink-subtle">Never</span>
        ),
    },
  ];

  if (canManage) {
    columns.push({
      id: "actions",
      header: "",
      align: "end",
      width: "w-12",
      cell: (member) => {
        const isSelf = member.user_id === me.user.id;
        return (
          <RowActions label={`Actions for ${member.full_name}`}>
            <DropdownMenuItem onSelect={() => setEditing(member)}>
              Edit role and title
            </DropdownMenuItem>
            {isSelf ? null : (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  tone={member.status === "active" ? "danger" : "default"}
                  onSelect={() =>
                    setAccess.mutate({
                      params: { path: { member_id: member.id } },
                      body: { status: member.status === "active" ? "suspended" : "active" },
                    })
                  }
                >
                  {member.status === "active" ? "Suspend access" : "Restore access"}
                </DropdownMenuItem>
              </>
            )}
          </RowActions>
        );
      },
    });
  }

  return (
    <>
      <PageHeader
        title="Members"
        description={`People who can sign in to ${me.organization?.name ?? "this organization"}, and what each of them can do.`}
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus />
              Add member
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput
            label="Search members"
            placeholder="Search by name or email"
            value={list.get("q")}
            onChange={(q) => list.update({ q })}
            className="w-full sm:w-72"
          />
          <div className="w-44">
            <Select
              aria-label="Filter by role"
              value={role ?? ""}
              onChange={(event) => list.update({ role: event.target.value })}
            >
              <option value="">All roles</option>
              {ROLE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {ROLE_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-36">
            <Select
              aria-label="Filter by access"
              value={status ?? ""}
              onChange={(event) => list.update({ status: event.target.value })}
            >
              <option value="">Any access</option>
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
          caption="Members"
          columns={columns}
          rows={members.data?.items}
          rowKey={(member) => member.id}
          isLoading={members.isPending}
          isRefreshing={members.isPlaceholderData}
          error={members.error}
          onRetry={() => void members.refetch()}
          sort={sort}
          onSortChange={(next) => list.update({ sort: next })}
          empty={
            <EmptyState
              icon={list.hasFilters ? UserRoundX : Users}
              title={list.hasFilters ? "No members match these filters" : "No members yet"}
              description={
                list.hasFilters
                  ? "Try a different search, or clear the filters to see everyone."
                  : "Add the people who need access to this organization."
              }
              action={
                list.hasFilters ? (
                  <Button size="sm" onClick={list.clear}>
                    Clear filters
                  </Button>
                ) : null
              }
            />
          }
        />

        {members.data && members.data.total > 0 ? (
          <Pagination
            page={members.data.page}
            pageSize={members.data.page_size}
            total={members.data.total}
            onPageChange={(page) => list.update({ page })}
            noun="members"
          />
        ) : null}
      </Panel>

      <AddMemberDialog open={adding} onOpenChange={setAdding} />
      <EditMemberDialog member={editing} onClose={() => setEditing(null)} />
    </>
  );
}
