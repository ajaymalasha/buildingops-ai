import { ShareBar } from "@/components/ui/bars";
import { Skeleton } from "@/components/ui/skeleton";
import { EXPENSE_CATEGORY_LABELS } from "@/features/expenses/expense-categories";
import type { CostShare, DashboardBuildings, DashboardSummary } from "@/lib/api/types";
import { toNumber } from "@/lib/chart";
import { isZero } from "@/lib/decimal";
import { formatHours, formatMoney, formatNumber, formatPercentPoint } from "@/lib/format";
import { cn } from "@/lib/utils";

import { NothingToShow } from "./report";

/** How many buildings the comparison shows: the costliest. */
export const BUILDINGS_SHOWN = 5;

// A bar is drawn where the section has room for one beside the figures, which it never
// has on a phone. The buildings have two more columns of figures, so need more room.
const BAR_FROM_MD = "@max-md:hidden";
const BAR_FROM_LG = "@max-lg:hidden";

// On a phone the buildings have no room for a column of hours either: the hours go under
// the cost, and the room goes to the building's name. A row's figures then stand level
// with the name's first line, not with the middle of however many lines it runs to.
const HOURS_COLUMN = "@max-md:hidden";
const HOURS_UNDER_COST = "@md:hidden";
const LEVEL = "@max-md:align-top";

function categoryLabel(category: CostShare["category"]): string {
  return category === "labor" ? "Labor" : EXPENSE_CATEGORY_LABELS[category];
}

/**
 * Operating cost for the period by what it was spent on: labor, and each kind of
 * expense, largest first. The lines come to the operating cost at the top of the page.
 */
export function CostByCategory({ summary }: { summary: DashboardSummary }) {
  const { currency } = summary;
  // Ordered for the eye, by the size of the bar. A kind nothing was spent on is left out.
  const lines = summary.cost_by_category
    .filter((line) => !isZero(line.amount))
    .sort((a, b) => toNumber(b.amount) - toNumber(a.amount));
  if (lines.length === 0) {
    return <NothingToShow>No time or expenses were approved in this period.</NothingToShow>;
  }
  return (
    <table className="w-full text-[13px] text-ink">
      <caption className="sr-only">Operating cost by category</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Amount</th>
          <th scope="col">Share of operating cost</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line border-t border-line-strong">
        {lines.map((line) => (
          <tr key={line.category}>
            <th scope="row" className="w-28 py-2.5 pr-3 text-left font-normal whitespace-nowrap">
              {categoryLabel(line.category)}
            </th>
            <td className="py-2.5 pr-3 text-right whitespace-nowrap tabular-nums">
              {formatMoney(line.amount, currency)}
            </td>
            <td className={cn("w-full py-2.5", BAR_FROM_MD)}>
              <ShareBar
                percent={toNumber(line.share_percent)}
                // Labor in graphite and expenses in the quieter tone, as in the chart above.
                tone={line.category === "labor" ? "graphite" : "muted"}
              />
            </td>
            <td className="py-2.5 pl-3 text-right whitespace-nowrap text-ink-muted tabular-nums">
              {line.share_percent === null ? null : formatPercentPoint(line.share_percent)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot className="border-t border-line-strong">
        <tr className="font-semibold">
          <th scope="row" className="py-3 pr-3 text-left font-semibold whitespace-nowrap">
            Operating cost
          </th>
          <td className="py-3 pr-3 text-right whitespace-nowrap tabular-nums">
            {formatMoney(summary.operating_cost.value, currency)}
          </td>
          <td className={BAR_FROM_MD} />
          <td />
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * The buildings that cost the most in the period, costliest first, with the hours worked
 * there and the work still open. Each bar is the building's cost beside the costliest.
 */
export function CostliestBuildings({ comparison }: { comparison: DashboardBuildings }) {
  const { currency } = comparison;
  const lines = comparison.buildings.slice(0, BUILDINGS_SHOWN);
  const costliest = Math.max(0, ...lines.map((line) => toNumber(line.operating_cost)));
  if (lines.length === 0) {
    return <NothingToShow>No building had costs or work orders in this period.</NothingToShow>;
  }
  return (
    <table className="w-full text-[13px] text-ink">
      <caption className="sr-only">Costliest buildings</caption>
      <thead>
        <tr className="border-b border-line-strong align-bottom text-xs text-ink-muted">
          <th scope="col" className="pr-2 pb-2 text-left font-medium @lg:pr-3">
            Building
          </th>
          <th scope="col" className="px-2 pb-2 text-right font-medium @lg:px-3">
            Cost
          </th>
          <th scope="col" className={cn("w-full pb-2", BAR_FROM_LG)}>
            <span className="sr-only">Cost beside the costliest</span>
          </th>
          <th scope="col" className={cn("px-2 pb-2 text-right font-medium @lg:px-3", HOURS_COLUMN)}>
            Hours
          </th>
          {/* Two words, so that in a narrow section the heading can take two lines and
              leave the room to the building's name. */}
          <th
            scope="col"
            className="pb-2 pl-2 text-right font-medium @lg:pl-3 @lg:whitespace-nowrap"
          >
            Open orders
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {lines.map((line) => (
          <tr key={line.building.id}>
            {/* Beside a bar, which takes all the room it is given, a long name is cut to
                fit. Without one the name has the room, and runs to a second line instead. */}
            <th
              scope="row"
              className={cn("py-2 pr-2 text-left font-normal @lg:max-w-48 @lg:pr-3", LEVEL)}
            >
              <span className="block font-medium @lg:truncate" title={line.building.name}>
                {line.building.name}
              </span>
              <span
                className="block text-xs text-ink-subtle @lg:truncate"
                title={line.customer.name}
              >
                {line.customer.name}
              </span>
            </th>
            <td
              className={cn("px-2 py-2 text-right whitespace-nowrap tabular-nums @lg:px-3", LEVEL)}
            >
              {formatMoney(line.operating_cost, currency)}
              <span className={cn("block text-xs text-ink-muted", HOURS_UNDER_COST)}>
                {formatHours(line.labor_hours)} hours
              </span>
            </td>
            <td className={cn("min-w-16 py-2", BAR_FROM_LG)}>
              <ShareBar percent={(toNumber(line.operating_cost) / (costliest || 1)) * 100} />
            </td>
            <td
              className={cn(
                "px-2 py-2 text-right whitespace-nowrap text-ink-muted tabular-nums @lg:px-3",
                HOURS_COLUMN,
              )}
            >
              {formatHours(line.labor_hours)}
            </td>
            <td className={cn("py-2 pl-2 text-right tabular-nums @lg:pl-3", LEVEL)}>
              {formatNumber(line.work_orders_open)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CostListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="divide-y divide-line border-t border-line-strong">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 py-3">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-1.5 flex-1" />
        </div>
      ))}
    </div>
  );
}
