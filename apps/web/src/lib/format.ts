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
