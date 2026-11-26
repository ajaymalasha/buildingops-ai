import type { Shift } from "@/lib/api/types";
import { zonedDateTime } from "@/lib/dates";
import {
  formatDuration,
  formatMonthDay,
  formatNumber,
  formatTime,
  formatWeekday,
} from "@/lib/format";

/** The day a shift starts on where the organization is, which is the day it belongs to. */
export function shiftDay(shift: Pick<Shift, "starts_at">, timeZone: string): string {
  return zonedDateTime(shift.starts_at, timeZone).date;
}

/** "5:00 PM – 1:30 AM": a shift's start and end on the organization's clocks. */
export function shiftHours(shift: Pick<Shift, "starts_at" | "ends_at">, timeZone: string): string {
  return `${formatTime(shift.starts_at, timeZone)} – ${formatTime(shift.ends_at, timeZone)}`;
}

/** "Mon, Nov 23, 5:00 PM – 1:30 AM": a shift as a confirmation names it. */
export function shiftWhen(shift: Pick<Shift, "starts_at" | "ends_at">, timeZone: string): string {
  const day = shiftDay(shift, timeZone);
  return `${formatWeekday(day)}, ${formatMonthDay(day)}, ${shiftHours(shift, timeZone)}`;
}

export type RosterRow = {
  employee: Shift["employee"];
  /** Their shifts by the day each starts on (YYYY-MM-DD), earliest first within a day. */
  days: Record<string, Shift[]>;
  /** How long they are scheduled for over the week, in minutes. */
  minutes: number;
};

/**
 * What a shift counts for, in minutes: from its start to its end, less the break. Both
 * ends are instants, so a night on which the clocks change counts the hours really worked.
 */
export function shiftMinutes(
  shift: Pick<Shift, "starts_at" | "ends_at" | "break_minutes">,
): number {
  const span = (new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime()) / 60_000;
  return Math.max(0, Math.round(span) - shift.break_minutes);
}

/**
 * A week's shifts as a roster: one row for each person who has a shift, by name, with
 * their shifts under the day each one starts on in the organization's time zone. A night
 * shift belongs to the day it begins.
 *
 * Cancelled shifts stay on record but free the person's time, so they never count towards
 * the hours. They are left off the roster altogether unless `showCancelled` is set, and
 * someone whose only shifts were cancelled is then not listed.
 */
export function buildRoster(
  shifts: readonly Shift[],
  timeZone: string,
  { showCancelled = false }: { showCancelled?: boolean } = {},
): RosterRow[] {
  const rows = new Map<string, RosterRow>();
  const startOf = (shift: Shift) => new Date(shift.starts_at).getTime();
  const inOrder = [...shifts].sort((a, b) => startOf(a) - startOf(b));
  for (const shift of inOrder) {
    const cancelled = shift.status === "cancelled";
    if (cancelled && !showCancelled) continue;
    const row = rows.get(shift.employee.id) ?? { employee: shift.employee, days: {}, minutes: 0 };
    const day = shiftDay(shift, timeZone);
    row.days[day] = [...(row.days[day] ?? []), shift];
    if (!cancelled) row.minutes += shiftMinutes(shift);
    rows.set(shift.employee.id, row);
  }
  return [...rows.values()].sort((a, b) =>
    a.employee.full_name.localeCompare(b.employee.full_name),
  );
}

/**
 * "6 people, 26 shifts, 207.5 h scheduled": what a roster adds up to. Cancelled shifts on
 * show are counted apart, because neither they nor their hours are anyone's work.
 */
export function rosterSummary(roster: readonly RosterRow[]): string {
  const shifts = roster.flatMap((row) => Object.values(row.days).flat());
  const cancelled = shifts.filter((shift) => shift.status === "cancelled").length;
  const minutes = roster.reduce((sum, row) => sum + row.minutes, 0);
  const count = (value: number, one: string, many: string) =>
    `${formatNumber(value)} ${value === 1 ? one : many}`;

  const summary = [
    count(roster.length, "person", "people"),
    count(shifts.length - cancelled, "shift", "shifts"),
    `${formatDuration(minutes)} scheduled`,
  ].join(", ");
  return cancelled > 0 ? `${summary}, plus ${formatNumber(cancelled)} cancelled` : summary;
}
