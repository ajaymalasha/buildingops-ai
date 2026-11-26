const LOCALE = "en-US";

/** "Nov 26, 2026, 3:07 AM" in the given IANA time zone (the organization's, normally). */
export function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

/** "Nov 26, 2026" */
export function formatDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeZone }).format(new Date(iso));
}

/**
 * "Mar 1, 2026" for a calendar date (`2026-03-01`): a contract's start, a hire date. A
 * date like this is the same day everywhere, so no time zone is applied to it.
 */
export function formatDay(date: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** "412,000" */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value);
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

// The API sends amounts as decimal strings ("18400.00"). Intl formats such a string digit
// for digit, so an amount is never turned into a floating-point number on its way to the
// screen. Anything that is not a decimal is shown as it came.
function formatDecimal(value: string, options: Intl.NumberFormatOptions): string {
  if (!DECIMAL.test(value)) return value;
  return new Intl.NumberFormat(LOCALE, options).format(value as Intl.StringNumericLiteral);
}

/** "$18,400.00" from "18400.00" and "USD". Display only: amounts stay strings elsewhere. */
export function formatMoney(value: string, currency: string): string {
  return formatDecimal(value, { style: "currency", currency });
}

/** "12.5%" from "12.50": a rate as people say it, without trailing zeros. */
export function formatPercent(value: string): string {
  return formatDecimal(value, { style: "unit", unit: "percent", maximumFractionDigits: 2 });
}

// Each unit is used up to the point where rounding would produce a whole one of the next
// unit, so this never says "60 minutes ago" or "12 months ago".
const RELATIVE_STEPS: [limit: number, divisor: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [59.5, 1, "second"],
  [59.5 * 60, 60, "minute"],
  [23.5 * 3600, 3600, "hour"],
  [6.5 * 86_400, 86_400, "day"],
  [2_629_800, 604_800, "week"],
  [11.5 * 2_629_800, 2_629_800, "month"],
  [Number.POSITIVE_INFINITY, 31_557_600, "year"],
];

/** "3 minutes ago", "in 2 days". `now` is injectable so the result can be tested. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  if (Math.abs(seconds) < 45) return "just now";
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  for (const [limit, divisor, unit] of RELATIVE_STEPS) {
    if (Math.abs(seconds) < limit) return formatter.format(Math.round(seconds / divisor), unit);
  }
  return formatter.format(Math.round(seconds / 31_557_600), "year");
}

/** "Dana Whitfield" -> "DW" */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]![0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** "operations_manager" -> "Operations manager"; "member.role_changed" -> "Member role changed" */
export function humanize(value: string): string {
  const words = value.replace(/[._]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
