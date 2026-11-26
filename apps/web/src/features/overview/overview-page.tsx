"use client";

import { ArrowRight, Check, Globe } from "lucide-react";
import Link from "next/link";

import { useCan, useMe } from "@/components/me-provider";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { $api } from "@/lib/api/client";
import { problemMessage } from "@/lib/api/problem";
import { formatRelative } from "@/lib/format";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Permission } from "@/lib/permissions";

/** One phrase per permission. Typed as a full record, so a new permission cannot be left out. */
const PERMISSION_PHRASES: Record<Permission, string> = {
  "organization:read": "View organization details",
  "organization:update": "Change organization settings",
  "members:read": "See who has access",
  "members:manage": "Add members and change their roles",
  "audit:read": "Read the audit log",
  "customers:read": "View customers",
  "customers:write": "Add and edit customers",
  "buildings:read": "View buildings",
  "buildings:write": "Add and edit buildings",
  "vendors:read": "View vendors",
  "vendors:write": "Add and edit vendors",
  "employees:read": "View employees and job roles",
  "employees:write": "Add and edit employees and job roles",
  "employees:read_compensation": "See and set pay rates",
  "contracts:read": "View contracts",
  "contracts:write": "Add and edit contracts",
  "work_orders:read": "View work orders",
  "work_orders:write": "Add and edit work orders",
  "schedule:read": "View the shift schedule",
  "schedule:write": "Schedule and cancel shifts",
  "timesheets:read": "View timesheets",
  "timesheets:write": "Enter and edit timesheets",
  "timesheets:approve": "Approve and reject timesheets",
  "expenses:read": "View expenses",
  "expenses:write": "Enter and edit expenses",
  "expenses:approve": "Approve and reject expenses",
  "invoices:read": "View invoices and payments",
  "dashboard:read": "See revenue, costs and margins on the dashboard",
  "platform:organizations": "Manage organizations across the platform",
};

export function OverviewPage() {
  const me = useMe();
  return me.organization ? <OrganizationHome /> : <NoOrganization />;
}

/**
 * Where someone lands in their organization: the dashboard, for those whose role includes
 * it, and for everyone else what was recently done and what they may do.
 */
function OrganizationHome() {
  return useCan("dashboard:read") ? <DashboardPage /> : <OrganizationOverview />;
}

function NoOrganization() {
  const me = useMe();
  return (
    <>
      <PageHeader title={`Welcome, ${me.user.full_name.split(" ")[0]}`} />
      <Panel>
        {me.user.is_platform_admin ? (
          <EmptyState
            icon={Globe}
            title="Choose an organization to work in"
            description="As a platform admin you are not inside any organization until you open one."
            action={
              <Button asChild variant="primary" size="sm">
                <Link href="/platform/organizations">View organizations</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="You don't have access to an organization"
            description="Your access may have been suspended. Ask your organization's administrator to restore it."
          />
        )}
      </Panel>
    </>
  );
}

function OrganizationOverview() {
  const me = useMe();
  const organization = me.organization!;
  const canSeeMembers = useCan("members:read");
  const canSeeAudit = useCan("audit:read");

  const members = $api.useQuery(
    "get",
    "/api/v1/members",
    { params: { query: { status: "active", page_size: 1 } } },
    { enabled: canSeeMembers },
  );
  const activity = $api.useQuery(
    "get",
    "/api/v1/audit-logs",
    { params: { query: { page_size: 8 } } },
    { enabled: canSeeAudit },
  );

  return (
    <>
      <PageHeader
        title={`Welcome back, ${me.user.full_name.split(" ")[0]}`}
        description={`You're working in ${organization.name}.`}
      />

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="activity-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="activity-heading" className="text-[15px] font-semibold text-ink">
              Recent activity
            </h2>
            {canSeeAudit ? (
              <Link
                href="/settings/audit-log"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:text-brand-800"
              >
                Audit log
                <ArrowRight className="size-3.5" />
              </Link>
            ) : null}
          </div>
          <Panel>
            {!canSeeAudit ? (
              <EmptyState
                title="Activity is visible to managers"
                description="Operations managers and company admins can review what changed in the organization."
              />
            ) : activity.isPending ? (
              <ul className="divide-y divide-line">
                {Array.from({ length: 5 }, (_, index) => (
                  <li key={index} className="flex items-center gap-3 px-4 py-3">
                    <Skeleton className="size-7 rounded-full" />
                    <Skeleton className="h-3.5 w-64" />
                  </li>
                ))}
              </ul>
            ) : activity.error ? (
              <ErrorState
                message={problemMessage(activity.error)}
                onRetry={() => void activity.refetch()}
              />
            ) : activity.data.items.length === 0 ? (
              <EmptyState title="No activity recorded yet" />
            ) : (
              <ul className="divide-y divide-line">
                {activity.data.items.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={entry.actor_name} />
                    <p className="min-w-0 flex-1 truncate text-[13px] text-ink">{entry.summary}</p>
                    <time dateTime={entry.created_at} className="shrink-0 text-xs text-ink-subtle">
                      {formatRelative(entry.created_at)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>

        <div className="space-y-8">
          <section aria-labelledby="organization-heading">
            <h2 id="organization-heading" className="mb-3 text-[15px] font-semibold text-ink">
              Organization
            </h2>
            <dl className="divide-y divide-line rounded-md border border-line bg-surface text-[13px]">
              {[
                ["Name", organization.name],
                ["Legal name", organization.legal_name ?? "Not set"],
                ["Time zone", organization.timezone.replace(/_/g, " ")],
                ["Currency", organization.currency],
              ].map(([term, value]) => (
                <div key={term} className="flex items-baseline justify-between gap-4 px-3.5 py-2.5">
                  <dt className="shrink-0 text-ink-muted">{term}</dt>
                  <dd className="truncate text-right text-ink">{value}</dd>
                </div>
              ))}
              {canSeeMembers ? (
                <div className="flex items-baseline justify-between gap-4 px-3.5 py-2.5">
                  <dt className="text-ink-muted">Active members</dt>
                  <dd className="text-ink tabular-nums">
                    {members.isPending ? (
                      <Skeleton className="h-3.5 w-6" />
                    ) : members.error ? (
                      <span className="text-ink-subtle">Unavailable</span>
                    ) : (
                      <Link
                        href="/settings/members"
                        className="font-medium text-brand-700 hover:text-brand-800"
                      >
                        {members.data.total.toLocaleString("en-US")}
                      </Link>
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section aria-labelledby="access-heading">
            <h2 id="access-heading" className="mb-3 text-[15px] font-semibold text-ink">
              Your access
            </h2>
            {me.role ? (
              <>
                <Badge tone="brand">{ROLE_LABELS[me.role]}</Badge>
                <p className="mt-2 text-[13px] text-ink-muted">{ROLE_DESCRIPTIONS[me.role]}</p>
              </>
            ) : null}
            <ul className="mt-3 space-y-1.5">
              {me.permissions.map((permission) => (
                <li key={permission} className="flex items-start gap-2 text-[13px] text-ink">
                  <Check className="mt-0.5 size-4 shrink-0 text-brand-600" />
                  {PERMISSION_PHRASES[permission]}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
