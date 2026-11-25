function offsetMinutes(at: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? "");
  if (!match) return 0; // "GMT" on its own means UTC
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * The instant at which a calendar day starts in a time zone.
 *
 * `2026-03-10` in `America/New_York` starts at `2026-03-10T04:00:00Z`. Used to turn the
 * dates people pick into the UTC range the API filters on.
 */
export function startOfDayInZone(date: string, timeZone: string): Date {
  const midnightUtc = new Date(`${date}T00:00:00Z`).getTime();
  // The offset depends on the instant, so estimate, then correct once (covers DST changes).
  const estimate = midnightUtc - offsetMinutes(new Date(midnightUtc), timeZone) * 60_000;
  return new Date(midnightUtc - offsetMinutes(new Date(estimate), timeZone) * 60_000);
}

/** The day after `date`, as YYYY-MM-DD. */
export function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
