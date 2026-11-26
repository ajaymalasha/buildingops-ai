"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { ChartNoAxesColumn, SearchX } from "lucide-react";
import Link from "next/link";

import { useCan, useMe } from "@/components/me-provider";
import { ChartLegend } from "@/components/ui/bar-chart";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { FilterSelect } from "@/components/ui/filter-select";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/states";
import { useListParams } from "@/hooks/use-list-params";
import { useBuildingOptions, useCustomerOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import type { DashboardSummary, DashboardTrends } from "@/lib/api/types";
import { todayInZone } from "@/lib/dates";
import { isZero } from "@/lib/decimal";
import { pickId, recordOptions } from "@/lib/forms";
import { formatDay, formatNumber, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ContractsTable, ContractsTableSkeleton } from "./contracts-table";
import {
  BUILDINGS_SHOWN,
  CostByCategory,
  CostListSkeleton,
  CostliestBuildings,
} from "./cost-breakdown";
import { figureLinks } from "./dashboard-links";
import {
  adjustRange,
  PERIOD_CHOICES,
  PERIOD_LABELS,
  periodFromParams,
  periodParams,
  type PeriodChoice,
} from "./dashboard-period";
import {
  AttentionBand,
  AttentionBandSkeleton,
  Footprint,
  HeadlineBand,
  HeadlineBandSkeleton,
} from "./headline-band";
import { ReportSection, SectionError } from "./report";
import {
  MONEY_SERIES,
  MoneyTrendChart,
  MONTH_TO_DATE,
  TrendChartSkeleton,
  WORK_SERIES,
  WorkTrendChart,
} from "./trend-chart";
import { WorkBacklog } from "./work-backlog";

// The period chooses what the page reports on. The customer and the building narrow it,
// and are what "Clear filters" clears.
const VIEW = ["period", "from", "to"] as const;
const TREND_MONTHS = 12;

/** Whether nothing at all has been recorded: no figure for the period, nothing waiting
 * today, and nothing in any month of the trend. */
function hasNothingToReport(summary: DashboardSummary, trends: DashboardTrends): boolean {
  const figures = [summary.revenue, summary.operating_cost, summary.collected];
  return (
    figures.every((figure) => isZero(figure.value) && isZero(figure.previous)) &&
    summary.work_orders_completed.value === 0 &&
    summary.work_orders_completed.previous === 0 &&
    summary.invoices_outstanding.count === 0 &&
    summary.timesheets_pending.count === 0 &&
    summary.expenses_pending.count === 0 &&
    summary.work_orders_open === 0 &&
    trends.months.every(
      (month) =>
        isZero(month.revenue) &&
        isZero(month.operating_cost) &&
        month.work_orders_opened === 0 &&
        month.work_orders_completed === 0,
    )
  );
}

/**
 * The executive dashboard: what the business earned, spent and kept in a period, what is
 * waiting on someone today, and where the money and the work go. Every figure is the
 * API's. Nothing is added up here.
 */
export function DashboardPage() {
  const me = useMe();
  const organization = me.organization!;
  const canSeeCustomers = useCan("customers:read");
  const canSeeBuildings = useCan("buildings:read");
  const list = useListParams({ view: VIEW });

  // A period is made of the organization's days, wherever the browser is.
  const today = todayInZone(organization.timezone);
  const period = periodFromParams(
    { period: list.get("period"), from: list.get("from"), to: list.get("to") },
    today,
  );
  const range = { from: period.from, to: period.to };
  const customerId = pickId(list.get("customer_id"));
  const buildingId = pickId(list.get("building_id"));
  const narrowing = { customer_id: customerId, building_id: buildingId };

  const options = { placeholderData: keepPreviousData };
  const summary = $api.useQuery(
    "get",
    "/api/v1/dashboard/summary",
    { params: { query: { ...range, ...narrowing } } },
    options,
  );
  const trends = $api.useQuery(
    "get",
    "/api/v1/dashboard/trends",
    { params: { query: { months: TREND_MONTHS, ...narrowing } } },
    options,
  );
  // Contracts and buildings are compared across a customer's, or everyone's: neither
  // can be narrowed to one building.
  const contracts = $api.useQuery(
    "get",
    "/api/v1/dashboard/contracts",
    { params: { query: { ...range, customer_id: customerId } } },
    options,
  );
  const buildings = $api.useQuery(
    "get",
    "/api/v1/dashboard/buildings",
    { params: { query: { ...range, customer_id: customerId } } },
    options,
  );
  const workOrders = $api.useQuery(
    "get",
    "/api/v1/dashboard/work-orders",
    { params: { query: { ...range, ...narrowing } } },
    options,
  );
  const customerOptions = useCustomerOptions({ enabled: canSeeCustomers });
  // With a customer chosen, only that customer's buildings are on offer.
  const buildingOptions = useBuildingOptions({ customerId, enabled: canSeeBuildings });

  const building = buildingOptions.data?.items.find((item) => item.id === buildingId);
  const links = figureLinks({
    customerId,
    buildingId,
    buildingIsCustomers: Boolean(customerId && building),
  });
  const periodLabel = formatPeriod(period.from, period.to);
  const nothing =
    summary.data && trends.data ? hasNothingToReport(summary.data, trends.data) : false;

  const choosePeriod = (choice: PeriodChoice) => list.update(periodParams(choice, range));

  return (
    <>
      <PageHeader
        title={`Welcome back, ${me.user.full_name.split(" ")[0]}`}
        description={`You're working in ${organization.name}.`}
        actions={
          summary.data && !nothing ? <Footprint summary={summary.data} links={links} /> : null
        }
      />

      {/* What follows is laid out by the width of the page (a container), not of the
          window: beside the sidebar the page is much the narrower of the two. */}
      <div className="@container">
        {nothing && !list.hasFilters ? null : (
          <div className="mb-7 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
              {/* The same choice twice: laid out in a row where there is room for one. */}
              <SegmentedControl
                label="Period"
                value={period.choice}
                segments={PERIOD_CHOICES.map((value) => ({ value, label: PERIOD_LABELS[value] }))}
                onChange={choosePeriod}
                className="@max-2xl:hidden"
              />
              <div className="w-full @2xl:hidden">
                <Select
                  aria-label="Period"
                  value={period.choice}
                  onChange={(event) => choosePeriod(event.target.value as PeriodChoice)}
                >
                  {PERIOD_CHOICES.map((value) => (
                    <option key={value} value={value}>
                      {PERIOD_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </div>
              {/* On a phone each filter has a line to itself: side by side, the name of the
                customer or the building chosen would be cut short. */}
              <div className="flex flex-wrap items-center gap-2 @max-2xl:w-full">
                {canSeeCustomers ? (
                  <FilterSelect
                    label="Filter by customer"
                    placeholder="All customers"
                    value={customerId}
                    options={recordOptions(customerOptions.data?.items ?? [])}
                    // Another customer's buildings are other buildings.
                    onChange={(value) => list.update({ customer_id: value, building_id: null })}
                    className="w-56 @max-2xl:min-w-0 @max-2xl:flex-1 @max-md:basis-full"
                  />
                ) : null}
                {canSeeBuildings ? (
                  <FilterSelect
                    label="Filter by building"
                    placeholder="All buildings"
                    value={buildingId}
                    options={recordOptions(buildingOptions.data?.items ?? [])}
                    onChange={(value) => list.update({ building_id: value })}
                    className="w-48 @max-2xl:min-w-0 @max-2xl:flex-1 @max-md:basis-full"
                  />
                ) : null}
                {list.hasFilters ? (
                  <Button variant="ghost" size="sm" onClick={list.clear}>
                    Clear filters
                  </Button>
                ) : null}
              </div>
            </div>
            {period.choice === "custom" ? (
              <DateRangeFilter
                label="Range"
                from={period.from}
                to={period.to}
                onChange={(change) => list.update(adjustRange(range, change))}
              />
            ) : null}
            {/* The notes are about figures, so they go when there are none to show. */}
            {summary.data && !nothing ? (
              <ScopeNotes summary={summary.data} building={building?.name} />
            ) : null}
          </div>
        )}

        {nothing ? (
          <NothingToReport
            organization={organization.name}
            filtered={list.hasFilters}
            onClear={list.clear}
            hasBuildings={(summary.data?.buildings.total ?? 0) > 0}
          />
        ) : (
          <div className="space-y-9">
            <section aria-labelledby="dashboard-period">
              <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2.5">
                <h2 id="dashboard-period" className="text-[15px] font-semibold text-ink">
                  {periodLabel}
                </h2>
                {summary.data ? (
                  <p className="text-[13px] text-ink-muted">
                    compared with{" "}
                    {formatPeriod(
                      summary.data.previous_period.start,
                      summary.data.previous_period.end,
                    )}
                  </p>
                ) : null}
              </div>
              {summary.data ? (
                <div
                  className={cn("transition-opacity", summary.isPlaceholderData && "opacity-60")}
                >
                  <HeadlineBand summary={summary.data} />
                </div>
              ) : summary.error ? (
                <SectionError error={summary.error} onRetry={() => void summary.refetch()} />
              ) : (
                <HeadlineBandSkeleton />
              )}
            </section>

            {summary.error && !summary.data ? null : (
              <section aria-labelledby="dashboard-attention">
                <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2.5">
                  <h2 id="dashboard-attention" className="text-[15px] font-semibold text-ink">
                    Needs attention
                  </h2>
                  {summary.data ? (
                    <p className="text-[13px] text-ink-muted">
                      as of today, {formatDay(summary.data.as_of)}
                    </p>
                  ) : null}
                </div>
                {summary.data ? (
                  <div
                    className={cn("transition-opacity", summary.isPlaceholderData && "opacity-60")}
                  >
                    <AttentionBand summary={summary.data} links={links} />
                  </div>
                ) : (
                  <AttentionBandSkeleton />
                )}
              </section>
            )}

            <ReportSection
              id="dashboard-trend"
              title="Revenue and operating cost"
              scope={`Last ${TREND_MONTHS} months`}
              aside={<ChartLegend series={MONEY_SERIES} partial={MONTH_TO_DATE} />}
            >
              {trends.data ? (
                <MoneyTrendChart trends={trends.data} />
              ) : trends.error ? (
                <SectionError error={trends.error} onRetry={() => void trends.refetch()} />
              ) : (
                <TrendChartSkeleton />
              )}
            </ReportSection>

            <ReportSection
              id="dashboard-contracts"
              title="Contract profitability"
              scope={building ? `${periodLabel}, not narrowed to ${building.name}` : periodLabel}
            >
              {contracts.data ? (
                <div
                  className={cn("transition-opacity", contracts.isPlaceholderData && "opacity-60")}
                >
                  <ContractsTable
                    profitability={contracts.data}
                    caption={`Contract profitability, ${periodLabel}`}
                  />
                </div>
              ) : contracts.error ? (
                <SectionError error={contracts.error} onRetry={() => void contracts.refetch()} />
              ) : (
                <ContractsTableSkeleton />
              )}
            </ReportSection>

            <div className="grid gap-x-12 gap-y-9 @4xl:grid-cols-2">
              <ReportSection id="dashboard-costs" title="Where the cost goes" scope={periodLabel}>
                {summary.data ? (
                  <div
                    className={cn("transition-opacity", summary.isPlaceholderData && "opacity-60")}
                  >
                    <CostByCategory summary={summary.data} />
                  </div>
                ) : summary.error ? (
                  <SectionError error={summary.error} onRetry={() => void summary.refetch()} />
                ) : (
                  <CostListSkeleton />
                )}
              </ReportSection>

              <ReportSection
                id="dashboard-buildings"
                title="Costliest buildings"
                scope={building ? `${periodLabel}, not narrowed to ${building.name}` : periodLabel}
              >
                {buildings.data ? (
                  <div
                    className={cn(
                      "transition-opacity",
                      buildings.isPlaceholderData && "opacity-60",
                    )}
                  >
                    <CostliestBuildings comparison={buildings.data} />
                    {buildings.data.buildings.length > BUILDINGS_SHOWN ? (
                      <p className="mt-3 text-xs text-ink-muted">
                        The {BUILDINGS_SHOWN} costliest of{" "}
                        {formatNumber(buildings.data.buildings.length)} buildings with costs or work
                        orders.
                      </p>
                    ) : null}
                  </div>
                ) : buildings.error ? (
                  <SectionError error={buildings.error} onRetry={() => void buildings.refetch()} />
                ) : (
                  <CostListSkeleton rows={BUILDINGS_SHOWN} />
                )}
              </ReportSection>
            </div>

            <div className="grid gap-x-12 gap-y-9 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <ReportSection id="dashboard-backlog" title="Open work orders" scope="As of today">
                {workOrders.data ? (
                  <WorkBacklog
                    counts={workOrders.data}
                    totals={
                      summary.data && {
                        open: summary.data.work_orders_open,
                        overdue: summary.data.work_orders_overdue,
                      }
                    }
                  />
                ) : workOrders.error ? (
                  <SectionError
                    error={workOrders.error}
                    onRetry={() => void workOrders.refetch()}
                  />
                ) : (
                  <CostListSkeleton rows={4} />
                )}
              </ReportSection>

              <ReportSection
                id="dashboard-work"
                title="Work orders opened and completed"
                scope={`Last ${TREND_MONTHS} months`}
                aside={<ChartLegend series={WORK_SERIES} partial={MONTH_TO_DATE} />}
              >
                {trends.data ? (
                  <>
                    <WorkTrendChart trends={trends.data} />
                    {workOrders.data && summary.data ? (
                      <p className="mt-4 text-[13px] text-ink-muted tabular-nums">
                        {periodLabel}:{" "}
                        <span className="font-medium text-ink">
                          {formatNumber(workOrders.data.opened)}
                        </span>{" "}
                        opened,{" "}
                        <span className="font-medium text-ink">
                          {formatNumber(summary.data.work_orders_completed.value)}
                        </span>{" "}
                        completed.
                      </p>
                    ) : null}
                  </>
                ) : trends.error ? (
                  <SectionError error={trends.error} onRetry={() => void trends.refetch()} />
                ) : (
                  <TrendChartSkeleton heightClass="h-44" />
                )}
              </ReportSection>
            </div>

            <Notes organization={organization.name} timeZone={organization.timezone} />
          </div>
        )}
      </div>
    </>
  );
}

/**
 * What the filters could not do. A figure that a filter cannot narrow, or can narrow
 * only roughly, must not pass for one that it did.
 */
function ScopeNotes({ summary, building }: { summary: DashboardSummary; building?: string }) {
  const { by_contract: byContract, organization_wide: organizationWide } = summary.scope;
  if (byContract.length === 0 && organizationWide.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-[13px] text-ink-muted">
      {byContract.length > 0 ? (
        <li>
          Revenue, margin, collections and invoices are those of the contracts that cover{" "}
          {building ?? "this building"}, in full: an invoice is for a contract, which may cover
          other buildings too.
        </li>
      ) : null}
      {organizationWide.length > 0 ? (
        <li>Employees and vendors are counted for the whole organization.</li>
      ) : null}
    </ul>
  );
}

type NothingToReportProps = {
  organization: string;
  filtered: boolean;
  onClear: () => void;
  hasBuildings: boolean;
};

function NothingToReport({ organization, filtered, onClear, hasBuildings }: NothingToReportProps) {
  if (filtered) {
    return (
      <EmptyState
        icon={SearchX}
        title="Nothing recorded for this selection"
        description="No revenue, costs or work orders match these filters, in this period or in the last 12 months."
        action={
          <Button size="sm" onClick={onClear}>
            Clear filters
          </Button>
        }
        className="border-y border-line py-20"
      />
    );
  }
  return (
    <EmptyState
      icon={ChartNoAxesColumn}
      title="Nothing to report yet"
      description={`Revenue, costs and margins appear here once ${organization} has approved time and expenses, invoices and work orders.`}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {hasBuildings ? (
            <>
              <Button asChild variant="primary" size="sm">
                <Link href="/work-orders">Go to work orders</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/timesheets">Go to timesheets</Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="primary" size="sm">
                <Link href="/customers">Start with customers</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/buildings">Then buildings</Link>
              </Button>
            </>
          )}
        </div>
      }
      className="border-y border-line py-20"
    />
  );
}

/** How the figures are counted, in small print, as a report carries its notes. */
function Notes({ organization, timeZone }: { organization: string; timeZone: string }) {
  return (
    <footer className="border-t border-line pt-5 text-xs leading-5 text-ink-muted">
      <h2 className="font-medium text-ink">How these figures are counted</h2>
      {/* Running text in two columns, not a grid: set in rows, a note would stand as far
          from the next as the note beside it is long. */}
      <ul className="mt-1.5 space-y-1.5 gap-x-12 *:break-inside-avoid @2xl:columns-2">
        <li>
          Revenue is the total of invoices that are issued or paid, on the day each was issued.
          Drafts and void invoices are left out.
        </li>
        <li>
          Operating cost is the labor cost of approved timesheets, on the day worked, and approved
          expenses, on the day incurred.
        </li>
        <li>
          Margin is revenue less operating cost. Collected is the payments received, on the day each
          came in.
        </li>
        <li>
          A period is compared with the same number of days just before it. A hatched month is still
          running, so its bars will grow.
        </li>
        <li>
          Days begin and end where {organization} is, in the {timeZone.replace(/_/g, " ")} time
          zone.
        </li>
        <li>
          What needs attention, and the open work orders, are as of today, whatever the period.
        </li>
      </ul>
    </footer>
  );
}
