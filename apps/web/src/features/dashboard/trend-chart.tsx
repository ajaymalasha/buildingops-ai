import { BarChart, type ChartPoint, type ChartSeries } from "@/components/ui/bar-chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardTrends, MonthTrend } from "@/lib/api/types";
import { toNumber } from "@/lib/chart";
import {
  formatMoney,
  formatMoneyTick,
  formatMonth,
  formatMonthDay,
  formatMonthYear,
  formatNumber,
  formatPercentPoint,
} from "@/lib/format";
import { cn } from "@/lib/utils";

import { isNegative } from "./headline-band";

export const MONEY_SERIES: ChartSeries[] = [
  { key: "revenue", label: "Revenue", tone: "brand" },
  // Labor and expenses stand on each other: together they are the operating cost.
  { key: "labor_cost", label: "Labor", tone: "graphite", stack: "cost" },
  { key: "expense_cost", label: "Expenses", tone: "muted", stack: "cost" },
];

export const WORK_SERIES: ChartSeries[] = [
  { key: "work_orders_opened", label: "Opened", tone: "graphite" },
  { key: "work_orders_completed", label: "Completed", tone: "brand" },
];

/** What hatching means in these charts: the month has not ended, so its bars will grow. */
export const MONTH_TO_DATE = "Month to date";

/** What a month is called in full. The one still running says how far it has got. */
function monthTitle(month: MonthTrend): string {
  const name = formatMonthYear(month.month);
  return month.is_partial ? `${name}, to ${formatMonthDay(month.end)}` : name;
}

/**
 * Under a column: the year under each January and under the first column, and a word for
 * the month still running.
 *
 * Two notes side by side do not fit under the columns of a phone, so beside a January's
 * year the other gives way. The first column's year does, as the January's says enough.
 * So does "to date", whether the January is the column before or the month still running
 * itself: the hatching says the month is not over, and nothing else says the year.
 */
function monthDetail(months: readonly MonthTrend[], index: number): string | undefined {
  const month = months[index]!;
  const isJanuary = (other: MonthTrend | undefined) => other?.month.slice(5, 7) === "01";
  const year = month.month.slice(0, 4);
  if (isJanuary(month)) return year;
  if (month.is_partial) return isJanuary(months[index - 1]) ? undefined : "to date";
  return index === 0 && !isJanuary(months[1]) ? year : undefined;
}

/** Revenue beside operating cost, month by month, the cost split into labor and expenses. */
export function MoneyTrendChart({ trends }: { trends: DashboardTrends }) {
  const { currency } = trends;
  const points: ChartPoint[] = trends.months.map((month, index) => ({
    key: month.month,
    label: formatMonth(month.month),
    detail: monthDetail(trends.months, index),
    partial: month.is_partial,
    values: {
      revenue: toNumber(month.revenue),
      labor_cost: toNumber(month.labor_cost),
      expense_cost: toNumber(month.expense_cost),
    },
    title: monthTitle(month),
    cells: [
      { text: formatMoney(month.revenue, currency) },
      { text: formatMoney(month.labor_cost, currency) },
      { text: formatMoney(month.expense_cost, currency) },
      { text: formatMoney(month.operating_cost, currency) },
      {
        text:
          formatMoney(month.margin, currency) +
          (month.margin_percent === null ? "" : ` (${formatPercentPoint(month.margin_percent)})`),
        critical: isNegative(month.margin),
      },
    ],
  }));
  return (
    <BarChart
      label="Revenue and operating cost by month"
      series={MONEY_SERIES}
      points={points}
      headings={["Month", "Revenue", "Labor", "Expenses", "Operating cost", "Margin"]}
      formatTick={(value) => formatMoneyTick(value, currency)}
      heightClass="h-64"
    />
  );
}

/** Work orders raised beside work orders finished, month by month. */
export function WorkTrendChart({ trends }: { trends: DashboardTrends }) {
  const points: ChartPoint[] = trends.months.map((month, index) => ({
    key: month.month,
    label: formatMonth(month.month),
    detail: monthDetail(trends.months, index),
    partial: month.is_partial,
    values: {
      work_orders_opened: month.work_orders_opened,
      work_orders_completed: month.work_orders_completed,
    },
    title: monthTitle(month),
    cells: [
      { text: formatNumber(month.work_orders_opened) },
      { text: formatNumber(month.work_orders_completed) },
    ],
  }));
  return (
    <BarChart
      label="Work orders opened and completed by month"
      series={WORK_SERIES}
      points={points}
      headings={["Month", "Opened", "Completed"]}
      formatTick={formatNumber}
      whole
      heightClass="h-44"
    />
  );
}

// Heights that rise and fall like a year of months, so the placeholder is shaped like
// the chart that takes its place. Each is a pair: the two bars of a month.
const PLACEHOLDER_BARS = [
  [48, 62],
  [56, 60],
  [54, 58],
  [60, 68],
  [70, 66],
  [72, 70],
  [68, 72],
  [86, 74],
  [84, 78],
  [90, 72],
  [88, 76],
  [86, 44],
];

export function TrendChartSkeleton({ heightClass = "h-64" }: { heightClass?: string }) {
  return (
    <div aria-hidden="true" className="animate-pulse">
      <div className={cn("flex border-b border-line-strong pl-12", heightClass)}>
        {PLACEHOLDER_BARS.map((pair, index) => (
          <div key={index} className="flex flex-1 items-end justify-center gap-[3px] px-[3px]">
            {pair.map((height, bar) => (
              <div
                key={bar}
                className="max-w-3.5 flex-1 bg-line/70"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        ))}
      </div>
      <Skeleton className="mt-3 ml-12 h-3" />
    </div>
  );
}
