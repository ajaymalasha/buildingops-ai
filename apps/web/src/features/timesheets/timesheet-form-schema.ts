import { z } from "zod";

import type { components } from "@/lib/api/schema";
import type { DecisionStatus, Timesheet, TimesheetSource, TimesheetSummary } from "@/lib/api/types";
import { isZero, sumDecimals } from "@/lib/decimal";
import { blankToNull, optionalHours, optionalText, requiredHours } from "@/lib/form-fields";

export const TIMESHEET_SOURCE_LABELS: Record<TimesheetSource, string> = {
  manual: "Manual",
  schedule: "Schedule",
  voice: "Voice",
  import: "Import",
};

// --- the halves of the approval queue ------------------------------------------------------

export const TIMESHEET_TABS = ["pending", "approved", "rejected", "all"] as const;

export type TimesheetTab = (typeof TIMESHEET_TABS)[number];

export const TIMESHEET_TAB_LABELS: Record<TimesheetTab, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  all: "All",
};

/** The status a tab asks the API for. "All" asks for every status. */
export function tabStatus(tab: TimesheetTab): DecisionStatus | undefined {
  return tab === "all" ? undefined : tab;
}

/**
 * How many timesheets each tab holds and the hours they come to, from the API's summary.
 * "All" is the three statuses together, added up exactly.
 */
export function tabTotals(
  summary: TimesheetSummary,
): Record<TimesheetTab, { count: number; hours: string }> {
  const { pending, approved, rejected } = summary;
  return {
    pending: { count: pending.count, hours: pending.hours_total },
    approved: { count: approved.count, hours: approved.hours_total },
    rejected: { count: rejected.count, hours: rejected.hours_total },
    all: {
      count: pending.count + approved.count + rejected.count,
      hours:
        sumDecimals([pending.hours_total, approved.hours_total, rejected.hours_total]) ?? "0.00",
    },
  };
}

// --- approving several at once -------------------------------------------------------------

type Hours = Pick<Timesheet, "hours_regular" | "hours_overtime">;

/** The hours a timesheet records, regular and overtime together, as a decimal string. */
export function totalHours(timesheets: readonly Hours[]): string {
  const hours = timesheets.flatMap((timesheet) => [
    timesheet.hours_regular,
    timesheet.hours_overtime,
  ]);
  return sumDecimals(hours) ?? "0.00";
}

/** Only a timesheet that is still pending can be approved, so only those can be ticked. */
export function isSelectable(timesheet: Pick<Timesheet, "status">): boolean {
  return timesheet.status === "pending";
}

// --- the form ------------------------------------------------------------------------------

export const timesheetSchema = z.object({
  employee_id: z.string().min(1, "Choose whose time this is."),
  building_id: z.string().min(1, "Choose the building they worked at."),
  contract_id: z.string(),
  work_date: z.string().min(1, "Choose the day they worked."),
  hours_regular: requiredHours("Enter the regular hours worked."),
  hours_overtime: optionalHours,
  notes: optionalText(5000),
});

export type TimesheetValues = z.infer<typeof timesheetSchema>;

export const TIMESHEET_FIELDS = timesheetSchema.keyof().options;

/**
 * The form as it opens: filled in from the timesheet being edited, or blank for a new one
 * apart from the day, which starts as today where the organization is.
 */
export function timesheetDefaults(
  timesheet: Timesheet | null,
  { today }: { today: string },
): TimesheetValues {
  return {
    employee_id: timesheet?.employee.id ?? "",
    building_id: timesheet?.building.id ?? "",
    contract_id: timesheet?.contract?.id ?? "",
    work_date: timesheet?.work_date ?? today,
    hours_regular: timesheet?.hours_regular ?? "",
    // No overtime is the usual case, and reads better as an empty box than as 0.00.
    hours_overtime: timesheet && !isZero(timesheet.hours_overtime) ? timesheet.hours_overtime : "",
    notes: timesheet?.notes ?? "",
  };
}

/**
 * A timesheet as the form sends it. The generated request type also lists the overtime
 * multiplier, because it has a default. That, like the hourly rate and the labor cost, is
 * the API's to set: the browser never sends or works out what time costs.
 */
export type TimesheetBody = Omit<components["schemas"]["TimesheetCreate"], "overtime_multiplier">;

/**
 * What is sent to the API, for a new timesheet and for a change to a pending one alike.
 * The contract is left out for someone who may not read contracts, and what the timesheet
 * is booked to is then left as it is.
 */
export function timesheetBody(
  values: TimesheetValues,
  { includeContract }: { includeContract: boolean },
): TimesheetBody {
  return {
    employee_id: values.employee_id,
    building_id: values.building_id,
    work_date: values.work_date,
    hours_regular: values.hours_regular,
    hours_overtime: values.hours_overtime === "" ? "0" : values.hours_overtime,
    notes: blankToNull(values.notes),
    ...(includeContract ? { contract_id: blankToNull(values.contract_id) } : {}),
  };
}
