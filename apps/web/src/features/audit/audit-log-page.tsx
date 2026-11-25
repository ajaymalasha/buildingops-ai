"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { ArrowRight, ScrollText } from "lucide-react";

import { useCan, useMe } from "@/components/me-provider";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input, Select } from "@/components/ui/input";
import { PageHeader, Panel } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState, NoAccess } from "@/components/ui/states";
import { useListParams } from "@/hooks/use-list-params";
import { $api } from "@/lib/api/client";
import type { AuditLogEntry } from "@/lib/api/types";
import { nextDay, startOfDayInZone } from "@/lib/dates";
import { formatDateTime, formatRelative, humanize } from "@/lib/format";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

const PAGE_SIZE = 30;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Activity categories. The value is the action prefix the API filters on. */
const CATEGORIES = [
  ["", "All activity"],
  ["member", "Members"],
  ["organization", "Organization"],
  ["auth", "Sign-ins"],
  ["user", "Account security"],
  ["platform", "Platform access"],
] as const;

const IDENTIFIER = /^[a-z]+(_[a-z]+)*$/;

/** How a recorded value reads in the table. Exported for tests. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  // Only codes such as `operations_manager` are reworded. Names, emails and the like are
  // shown exactly as they were recorded.
  if (typeof value === "string") return IDENTIFIER.test(value) ? humanize(value) : value;
  return String(value);
}

function Changes({ changes }: { changes: AuditLogEntry["changes"] }) {
  const entries = Object.entries(changes ?? {}).filter(
    (entry): entry is [string, { from: unknown; to: unknown }] =>
      typeof entry[1] === "object" && entry[1] !== null && "to" in entry[1],
  );
  if (entries.length === 0) return <span className="text-ink-subtle">—</span>;
  return (
    <ul className="space-y-0.5">
      {entries.map(([field, change]) => (
        <li key={field} className="flex flex-wrap items-center gap-x-1.5 text-xs">
          <span className="text-ink-muted">{humanize(field)}</span>
          <span className="text-ink-subtle line-through">{formatValue(change.from)}</span>
          <ArrowRight aria-label="changed to" className="size-3 text-ink-subtle" />
          <span className="font-medium text-ink">{formatValue(change.to)}</span>
        </li>
      ))}
    </ul>
  );
}

export function AuditLogPage() {
  return useCan("audit:read") ? <AuditLog /> : <NoAccess what="the audit log" />;
}

function AuditLog() {
  const me = useMe();
  const list = useListParams();
  const timeZone = me.organization?.timezone ?? "UTC";

  const from = list.get("from");
  const to = list.get("to");
  const since =
    from && DATE_PATTERN.test(from) ? startOfDayInZone(from, timeZone).toISOString() : undefined;
  // "To" is inclusive for the person choosing it, so the range ends when the next day starts.
  const until =
    to && DATE_PATTERN.test(to) ? startOfDayInZone(nextDay(to), timeZone).toISOString() : undefined;

  const entries = $api.useQuery(
    "get",
    "/api/v1/audit-logs",
    {
      params: {
        query: {
          q: list.get("q"),
          action: list.get("category"),
          since,
          until,
          page: list.page,
          page_size: PAGE_SIZE,
        },
      },
    },
    { placeholderData: keepPreviousData },
  );

  const columns: Column<AuditLogEntry>[] = [
    {
      id: "when",
      header: "When",
      width: "w-48",
      cell: (entry) => (
        <div>
          <p className="text-ink tabular-nums">{formatDateTime(entry.created_at, timeZone)}</p>
          <p className="text-xs text-ink-subtle">{formatRelative(entry.created_at)}</p>
        </div>
      ),
    },
    {
      id: "who",
      header: "Who",
      width: "w-52",
      cell: (entry) => (
        <div>
          <p className="font-medium text-ink">{entry.actor_name}</p>
          {entry.actor_role ? (
            <p className="text-xs text-ink-subtle">
              {ROLE_LABELS[entry.actor_role as Role] ?? humanize(entry.actor_role)}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "what",
      header: "What happened",
      cell: (entry) => (
        <div>
          <p className="text-ink">{entry.summary}</p>
          <p className="font-mono text-[11px] text-ink-subtle">{entry.action}</p>
        </div>
      ),
    },
    {
      id: "changes",
      header: "Changes",
      cell: (entry) => <Changes changes={entry.changes} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="A permanent record of sign-ins and changes in this organization. Entries cannot be edited or removed."
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput
            label="Search the audit log"
            placeholder="Search by person or description"
            value={list.get("q")}
            onChange={(q) => list.update({ q })}
            className="w-full sm:w-72"
          />
          <div className="w-44">
            <Select
              aria-label="Filter by activity"
              value={list.get("category") ?? ""}
              onChange={(event) => list.update({ category: event.target.value })}
            >
              {CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="From date"
              className="w-38"
              value={from ?? ""}
              max={to}
              onChange={(event) => list.update({ from: event.target.value })}
            />
            <span className="text-xs text-ink-subtle">to</span>
            <Input
              type="date"
              aria-label="To date"
              className="w-38"
              value={to ?? ""}
              min={from}
              onChange={(event) => list.update({ to: event.target.value })}
            />
          </div>
          {list.hasFilters ? (
            <Button variant="ghost" size="sm" onClick={list.clear}>
              Clear filters
            </Button>
          ) : null}
        </div>

        <DataTable
          caption="Audit log entries"
          columns={columns}
          rows={entries.data?.items}
          rowKey={(entry) => entry.id}
          isLoading={entries.isPending}
          isRefreshing={entries.isPlaceholderData}
          error={entries.error}
          onRetry={() => void entries.refetch()}
          empty={
            <EmptyState
              icon={ScrollText}
              title={list.hasFilters ? "Nothing matches these filters" : "No activity recorded yet"}
              description={
                list.hasFilters
                  ? "Widen the date range or clear the filters."
                  : "Sign-ins and changes will appear here as they happen."
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

        {entries.data && entries.data.total > 0 ? (
          <Pagination
            page={entries.data.page}
            pageSize={entries.data.page_size}
            total={entries.data.total}
            onPageChange={(page) => list.update({ page })}
            noun="entries"
          />
        ) : null}
      </Panel>

      <p className="mt-3 text-xs text-ink-subtle">
        Times are shown in {timeZone.replace(/_/g, " ")}.
      </p>
    </>
  );
}
