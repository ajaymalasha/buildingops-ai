import {
  addDays,
  daysBetween,
  endOfMonth,
  isCalendarDate,
  startOfMonth,
  startOfQuarter,
  startOfYear,
} from "@/lib/dates";
import { pick, pickDate } from "@/lib/forms";

/**
 * The period the dashboard reports on: a run of calendar days where the organization is,
 * both ends included. It is either one of the presets, which move with today, or a range
 * someone chose.
 */
const PERIOD_PRESETS = [
  "this_month",
  "last_month",
  "this_quarter",
  "year_to_date",
  "last_12_months",
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export type PeriodChoice = PeriodPreset | "custom";

export const PERIOD_CHOICES: readonly PeriodChoice[] = [...PERIOD_PRESETS, "custom"];

export const PERIOD_LABELS: Record<PeriodChoice, string> = {
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  year_to_date: "Year to date",
  last_12_months: "Last 12 months",
  custom: "Custom range",
};

/**
 * What the dashboard opens on: the last month that is over.
 *
 * Invoices for a month's work go out early in the next one, so a month still running has
 * most of its revenue and only part of its costs, and a margin that says more about the
 * calendar than about the business. The last complete month is the latest period whose
 * figures are all in.
 */
export const DEFAULT_PERIOD: PeriodPreset = "last_month";

/** The longest period the API answers for: three years, a leap day among them. */
export const MAX_PERIOD_DAYS = 1096;

export type DateRange = { from: string; to: string };

/** The days a preset covers when today is `today` (YYYY-MM-DD, where the organization is). */
export function presetRange(preset: PeriodPreset, today: string): DateRange {
  switch (preset) {
    case "this_month":
      return { from: startOfMonth(today), to: today };
    case "last_month": {
      const from = startOfMonth(today, -1);
      return { from, to: endOfMonth(from) };
    }
    case "this_quarter":
      return { from: startOfQuarter(today), to: today };
    case "year_to_date":
      return { from: startOfYear(today), to: today };
    // This month so far and the eleven before it: the twelve months the trend chart
    // shows, so that its bars add up to the figures above it.
    case "last_12_months":
      return { from: startOfMonth(today, -11), to: today };
  }
}

/** Whether two days make a period the API will answer for. */
export function isPeriod(from: string | undefined, to: string | undefined): boolean {
  if (!from || !to || !isCalendarDate(from) || !isCalendarDate(to)) return false;
  const days = daysBetween(from, to) + 1;
  return days >= 1 && days <= MAX_PERIOD_DAYS;
}

export type Period = DateRange & { choice: PeriodChoice };

type PeriodParams = { period?: string; from?: string; to?: string };

/**
 * The period a URL asks for. `period` names a preset, or says `custom` and comes with
 * `from` and `to`. Anything else, such as a preset that does not exist or a range that
 * runs backwards, is the default: a link that has gone stale still shows something true.
 */
export function periodFromParams(params: PeriodParams, today: string): Period {
  const choice = pick(params.period, PERIOD_CHOICES) ?? DEFAULT_PERIOD;
  if (choice !== "custom") return { choice, ...presetRange(choice, today) };
  const from = pickDate(params.from);
  const to = pickDate(params.to);
  if (from && to && isPeriod(from, to)) return { choice, from, to };
  return { choice: DEFAULT_PERIOD, ...presetRange(DEFAULT_PERIOD, today) };
}

/** What goes in the URL for a choice of period. The default leaves nothing there. */
export function periodParams(
  choice: PeriodChoice,
  current: DateRange,
): { period: string | null; from: string | null; to: string | null } {
  // A custom range starts out as the days already on show, to be changed from there.
  if (choice === "custom") return { period: "custom", from: current.from, to: current.to };
  return { period: choice === DEFAULT_PERIOD ? null : choice, from: null, to: null };
}

/**
 * A custom range after one of its ends was changed. The other end gives way, as little as
 * it has to, so that the range still runs forwards and is no longer than the API allows.
 * An end that was emptied, or is not a date, changes nothing.
 */
export function adjustRange(
  range: DateRange,
  change: { from: string } | { to: string },
): DateRange {
  if ("from" in change) {
    const from = change.from;
    if (!isCalendarDate(from)) return range;
    const latest = addDays(from, MAX_PERIOD_DAYS - 1);
    const to = range.to < from ? from : range.to > latest ? latest : range.to;
    return { from, to };
  }
  const to = change.to;
  if (!isCalendarDate(to)) return range;
  const earliest = addDays(to, -(MAX_PERIOD_DAYS - 1));
  const from = range.from > to ? to : range.from < earliest ? earliest : range.from;
  return { from, to };
}
