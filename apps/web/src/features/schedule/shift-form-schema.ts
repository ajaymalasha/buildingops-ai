import { z } from "zod";

import type { components } from "@/lib/api/schema";
import type { Shift, ShiftStatus } from "@/lib/api/types";
import { addDays, instantInZone, isCalendarDate, zonedDateTime } from "@/lib/dates";
import { blankToNull, optionalText, timeOfDay } from "@/lib/form-fields";

export const SHIFT_STATUS_LABELS: Record<ShiftStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  missed: "Missed",
  cancelled: "Cancelled",
};

/**
 * A shift as the form holds it: a day and two times of day, as clocks where the
 * organization works show them. The API takes and returns instants, so these are turned
 * into instants on the way out and back into clock times on the way in.
 */
export const shiftSchema = z.object({
  employee_id: z.string().min(1, "Choose who works the shift."),
  date: z.string().refine(isCalendarDate, "Choose the day the shift starts."),
  starts_at: timeOfDay("Enter the time the shift starts."),
  ends_at: timeOfDay("Enter the time the shift ends."),
  break_minutes: z
    .string()
    .trim()
    .regex(/^\d{0,3}$/, "Enter a whole number of minutes."),
  notes: optionalText(5000),
});

export type ShiftValues = z.infer<typeof shiftSchema>;

/**
 * The fields the API's answers are put on. An overlap with another of the person's shifts
 * is reported on `starts_at`, but it is about the shift as a whole, so it is left out
 * here and shown at the top of the form instead.
 */
export const SHIFT_FIELDS = ["employee_id", "ends_at", "break_minutes", "notes"] as const;

type NewShift = {
  /** The organization's time zone. */
  timeZone: string;
  /** The day a new shift starts on, until another is chosen. */
  date: string;
};

/**
 * The form as it opens: the shift being edited, on the organization's clocks, or a day
 * shift of eight hours with half an hour's break for a new one.
 */
export function shiftDefaults(shift: Shift | null, { timeZone, date }: NewShift): ShiftValues {
  if (!shift) {
    return {
      employee_id: "",
      date,
      starts_at: "08:00",
      ends_at: "16:30",
      break_minutes: "30",
      notes: "",
    };
  }
  const start = zonedDateTime(shift.starts_at, timeZone);
  return {
    employee_id: shift.employee.id,
    date: start.date,
    starts_at: start.time,
    ends_at: zonedDateTime(shift.ends_at, timeZone).time,
    break_minutes: String(shift.break_minutes),
    notes: shift.notes ?? "",
  };
}

type Times = Pick<ShiftValues, "date" | "starts_at" | "ends_at">;

/** Whether the end time belongs to the day after the start: a shift that runs past midnight. */
export function endsNextDay({ starts_at, ends_at }: Pick<Times, "starts_at" | "ends_at">): boolean {
  return starts_at !== "" && ends_at !== "" && ends_at <= starts_at;
}

/**
 * The instants a shift starts and ends at, from the day and the clock times in the form.
 * An end at or before the start is taken as the next day's. Null if a part is missing.
 */
export function shiftInstants(
  values: Times,
  timeZone: string,
): { starts_at: string; ends_at: string } | null {
  const start = instantInZone(values.date, values.starts_at, timeZone);
  const endDay = endsNextDay(values) ? addDays(values.date, 1) : values.date;
  const end = start ? instantInZone(endDay, values.ends_at, timeZone) : null;
  if (!start || !end) return null;
  return { starts_at: start.toISOString(), ends_at: end.toISOString() };
}

type Where = { buildingId: string; timeZone: string };

/** Everything about a shift but when it is. */
function details(values: ShiftValues, buildingId: string) {
  return {
    employee_id: values.employee_id,
    building_id: buildingId,
    break_minutes: values.break_minutes === "" ? 0 : Number.parseInt(values.break_minutes, 10),
    notes: blankToNull(values.notes),
  };
}

/** What is sent to schedule a new shift. Null if its day or times do not make a real moment. */
export function newShiftBody(
  values: ShiftValues,
  { buildingId, timeZone }: Where,
): components["schemas"]["ShiftCreate"] | null {
  const times = shiftInstants(values, timeZone);
  return times ? { ...details(values, buildingId), ...times } : null;
}

/**
 * What is sent to change a shift that the form opened with the values in `opened`.
 *
 * The start and the end are sent only when the day or a time was changed. A clock time
 * can stand for two instants on the night the clocks go back, so sending back times that
 * nobody touched could move a shift by an hour.
 */
export function changedShiftBody(
  values: ShiftValues,
  opened: ShiftValues,
  { buildingId, timeZone }: Where,
): components["schemas"]["ShiftUpdate"] {
  const moved =
    opened.date !== values.date ||
    opened.starts_at !== values.starts_at ||
    opened.ends_at !== values.ends_at;
  return {
    ...details(values, buildingId),
    ...(moved ? shiftInstants(values, timeZone) : {}),
  };
}
