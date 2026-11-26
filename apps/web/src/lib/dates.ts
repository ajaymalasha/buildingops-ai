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

/** Today's calendar date in a time zone, as YYYY-MM-DD. `now` is injectable for tests. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Whole days from one calendar date to another. Negative when `to` is the earlier one. */
export function daysBetween(from: string, to: string): number {
  const day = (date: string) => new Date(`${date}T00:00:00Z`).getTime();
  return Math.round((day(to) - day(from)) / 86_400_000);
}

/** The calendar date `days` after `date`, or before it when negative, as YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** The day after `date`, as YYYY-MM-DD. */
export function nextDay(date: string): string {
  return addDays(date, 1);
}

/** The Monday of the week `date` falls in. A week runs from Monday to Sunday. */
export function startOfWeek(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // Sunday is 0
  return addDays(date, -((weekday + 6) % 7));
}

/** The seven days of the week that starts on `monday`, in order. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/**
 * The first day of the month `date` is in, or of the month that many `months` after it
 * (before it, when negative), as YYYY-MM-DD.
 */
export function startOfMonth(date: string, months = 0): string {
  const day = new Date(`${date}T00:00:00Z`);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + months, 1))
    .toISOString()
    .slice(0, 10);
}

/** The last day of the month `date` is in. */
export function endOfMonth(date: string): string {
  return addDays(startOfMonth(date, 1), -1);
}

/** The first day of the quarter `date` is in: of January, April, July or October. */
export function startOfQuarter(date: string): string {
  const month = new Date(`${date}T00:00:00Z`).getUTCMonth(); // January is 0
  return startOfMonth(date, -(month % 3));
}

/** The first day of the year `date` is in. */
export function startOfYear(date: string): string {
  return `${date.slice(0, 4)}-01-01`;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;

/** Whether `value` is a calendar date that exists, written YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The day and the time that clocks in a time zone show at an instant.
 *
 * `2026-11-26T22:00:00Z` in `America/New_York` is `2026-11-26` at `17:00`. The time is on
 * the 24-hour clock, as a time input takes it.
 */
export function zonedDateTime(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

/**
 * The instant at which clocks in a time zone show `time` (HH:MM) on `date` (YYYY-MM-DD).
 *
 * Twice a year the clocks do not say. When they go forward, an hour of the night never
 * appears on them: a time in it is taken as that long after the hour before, so 02:30 on
 * such a night in New York is the instant clocks show 03:30. When they go back, an hour
 * comes round twice: the first time is the one meant. Those are the choices calendars
 * make, and they keep a shift as long as the clock times say it is.
 *
 * Returns null if either part is not a real date or time.
 */
export function instantInZone(date: string, time: string, timeZone: string): Date | null {
  const clock = TIME.exec(time);
  if (!isCalendarDate(date) || !clock || Number(clock[1]) > 23 || Number(clock[2]) > 59) {
    return null;
  }
  // The wall-clock reading as if it were UTC. The instant is this, less the zone's offset.
  const reading = new Date(`${date}T${time}:00Z`).getTime();
  // The offsets in force a day either side: the same, unless the clocks change in between.
  const before = offsetMinutes(new Date(reading - 86_400_000), timeZone);
  const after = offsetMinutes(new Date(reading + 86_400_000), timeZone);
  const at = (offset: number) => new Date(reading - offset * 60_000);
  // Earliest first. A reading is real under an offset if the zone has that offset then.
  for (const offset of before >= after ? [before, after] : [after, before]) {
    if (offsetMinutes(at(offset), timeZone) === offset) return at(offset);
  }
  // No offset gives this reading: it falls in the hour the clocks skip.
  return at(before);
}

/** An instant as a `datetime-local` input shows it in a time zone: `2026-11-26T17:00`. */
export function toDateTimeInput(iso: string, timeZone: string): string {
  const { date, time } = zonedDateTime(iso, timeZone);
  return `${date}T${time}`;
}

/** The instant a `datetime-local` input's value stands for in a time zone, or null. */
export function fromDateTimeInput(value: string, timeZone: string): Date | null {
  const [date = "", time = ""] = value.split("T");
  return instantInZone(date, time.slice(0, 5), timeZone);
}
