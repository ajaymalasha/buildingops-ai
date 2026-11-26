import { daysBetween } from "@/lib/dates";

/** Insurance that lapses within this many days is flagged, so it can be renewed in time. */
export const INSURANCE_WARNING_DAYS = 30;

export type InsuranceStatus =
  /** No certificate on file. */
  | { state: "missing" }
  /** Expired before today. `days` is how long ago. */
  | { state: "lapsed"; days: number }
  /** Still valid, but expires within the warning period. `days` is how many are left. */
  | { state: "expiring"; days: number }
  | { state: "current" };

/**
 * Where a vendor's insurance stands on `today`. Both dates are calendar dates
 * (YYYY-MM-DD); `today` is the organization's. A certificate is valid through the day it
 * expires on.
 */
export function insuranceStatus(expiresOn: string | null, today: string): InsuranceStatus {
  if (!expiresOn) return { state: "missing" };
  const daysLeft = daysBetween(today, expiresOn);
  if (daysLeft < 0) return { state: "lapsed", days: -daysLeft };
  if (daysLeft <= INSURANCE_WARNING_DAYS) return { state: "expiring", days: daysLeft };
  return { state: "current" };
}

const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** "Lapsed 18 days ago", "Expires in 9 days", "Expires today". Null when nothing needs saying. */
export function insuranceFlag(status: InsuranceStatus): string | null {
  if (status.state === "lapsed") return `Lapsed ${relative.format(-status.days, "day")}`;
  if (status.state === "expiring") return `Expires ${relative.format(status.days, "day")}`;
  return null;
}
