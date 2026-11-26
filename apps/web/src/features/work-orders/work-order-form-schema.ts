import { z } from "zod";

import type { BadgeTone } from "@/components/ui/badge";
import type { components } from "@/lib/api/schema";
import type {
  Employee,
  WorkOrder,
  WorkOrderCategory,
  WorkOrderPriority,
  WorkOrderSource,
} from "@/lib/api/types";
import { fromDateTimeInput, toDateTimeInput } from "@/lib/dates";
import { blankToNull, optionalText, requiredText } from "@/lib/form-fields";

export const WORK_ORDER_CATEGORIES = [
  "cleaning",
  "maintenance",
  "repair",
  "inspection",
  "hvac",
  "electrical",
  "plumbing",
  "landscaping",
  "security",
  "other",
] as const;

export const WORK_ORDER_CATEGORY_LABELS: Record<WorkOrderCategory, string> = {
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  repair: "Repair",
  inspection: "Inspection",
  hvac: "HVAC",
  electrical: "Electrical",
  plumbing: "Plumbing",
  landscaping: "Landscaping",
  security: "Security",
  other: "Other",
};

export const WORK_ORDER_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export const WORK_ORDER_PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

// Colour is kept for what cannot wait.
export const WORK_ORDER_PRIORITY_TONES: Record<WorkOrderPriority, BadgeTone> = {
  low: "neutral",
  normal: "neutral",
  high: "caution",
  urgent: "critical",
};

export const WORK_ORDER_SOURCES = [
  "internal",
  "customer_request",
  "inspection",
  "preventive",
] as const;

export const WORK_ORDER_SOURCE_LABELS: Record<WorkOrderSource, string> = {
  internal: "Internal",
  customer_request: "Customer request",
  inspection: "Inspection",
  preventive: "Preventive maintenance",
};

/** What a `datetime-local` input gives: a day and a time, with no zone. */
const DATE_AND_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export const workOrderSchema = z.object({
  title: requiredText(200, "Enter what needs doing."),
  description: optionalText(5000),
  building_id: z.string().min(1, "Choose the building the work is at."),
  contract_id: z.string(),
  category: z.enum(WORK_ORDER_CATEGORIES),
  priority: z.enum(WORK_ORDER_PRIORITIES),
  source: z.enum(WORK_ORDER_SOURCES),
  assigned_employee_id: z.string(),
  vendor_id: z.string(),
  requested_by: optionalText(200),
  due_on: z.string(),
  scheduled_for: z
    .string()
    .refine((value) => value === "" || DATE_AND_TIME.test(value), "Choose a day and a time."),
  billable: z.boolean(),
});

export type WorkOrderValues = z.infer<typeof workOrderSchema>;

export const WORK_ORDER_FIELDS = workOrderSchema.keyof().options;

type NewWorkOrder = {
  /** The organization's time zone: the scheduled time is shown on its clocks. */
  timeZone: string;
  /** Preselected when the list the form was opened from shows one building's work orders. */
  buildingId?: string;
};

/** The form as it opens: filled in from the work order being edited, or blank for a new one. */
export function workOrderDefaults(
  workOrder: WorkOrder | null,
  { timeZone, buildingId = "" }: NewWorkOrder,
): WorkOrderValues {
  return {
    title: workOrder?.title ?? "",
    description: workOrder?.description ?? "",
    building_id: workOrder?.building.id ?? buildingId,
    contract_id: workOrder?.contract?.id ?? "",
    category: workOrder?.category ?? "cleaning",
    priority: workOrder?.priority ?? "normal",
    source: workOrder?.source ?? "internal",
    assigned_employee_id: workOrder?.assigned_employee?.id ?? "",
    vendor_id: workOrder?.vendor?.id ?? "",
    requested_by: workOrder?.requested_by ?? "",
    due_on: workOrder?.due_on ?? "",
    scheduled_for: workOrder?.scheduled_for
      ? toDateTimeInput(workOrder.scheduled_for, timeZone)
      : "",
    billable: workOrder?.billable ?? true,
  };
}

type BodyOptions = {
  timeZone: string;
  /**
   * Which of the choices from other lists the form offered. It leaves one out for someone
   * who may not read that list, and what the work order holds is then left as it is.
   */
  offered: { contract: boolean; assignee: boolean; vendor: boolean };
  /** The values the form opened with for an existing work order. Null for a new one. */
  opened: WorkOrderValues | null;
};

/**
 * What is sent to the API, for a new work order and for a change to one alike. The status
 * is not part of it: a work order moves between statuses through its own endpoint.
 *
 * The scheduled time is sent as an instant, and only when it was changed. The form shows
 * it to the minute, so sending back a time nobody touched could shave its seconds off.
 */
export function workOrderBody(
  values: WorkOrderValues,
  { timeZone, offered, opened }: BodyOptions,
): components["schemas"]["WorkOrderCreate"] {
  const rescheduled = opened === null || opened.scheduled_for !== values.scheduled_for;
  return {
    title: values.title,
    description: blankToNull(values.description),
    building_id: values.building_id,
    category: values.category,
    priority: values.priority,
    source: values.source,
    requested_by: blankToNull(values.requested_by),
    due_on: blankToNull(values.due_on),
    billable: values.billable,
    ...(offered.contract ? { contract_id: blankToNull(values.contract_id) } : {}),
    ...(offered.assignee ? { assigned_employee_id: blankToNull(values.assigned_employee_id) } : {}),
    ...(offered.vendor ? { vendor_id: blankToNull(values.vendor_id) } : {}),
    ...(rescheduled
      ? {
          scheduled_for: fromDateTimeInput(values.scheduled_for, timeZone)?.toISOString() ?? null,
        }
      : {}),
  };
}

// --- who the work can be given to ----------------------------------------------------------

export type AssigneeGroup = { label: string; people: { id: string; name: string }[] };

type Candidate = Pick<Employee, "id" | "full_name" | "status">;

/**
 * Who the "assigned to" select offers: first the people assigned to the building the work
 * is at, then everyone else. Both lists arrive by last name and keep that order.
 *
 * People who have left are not offered. The assignee already saved on the work order is
 * always kept, in a group of their own if they would otherwise be missing, so that opening
 * the form and saving it changes nothing.
 */
export function assigneeGroups(
  atBuilding: readonly Candidate[],
  everyone: readonly Candidate[],
  current: { id: string; full_name: string } | null,
  buildingName?: string,
): AssigneeGroup[] {
  const offered = (person: Candidate) =>
    person.status !== "terminated" || person.id === current?.id;
  const named = (person: { id: string; full_name: string }) => ({
    id: person.id,
    name: person.full_name,
  });
  const here = atBuilding.filter(offered);
  const hereIds = new Set(here.map((person) => person.id));
  const elsewhere = everyone.filter((person) => offered(person) && !hereIds.has(person.id));

  const groups: AssigneeGroup[] = [];
  if (
    current &&
    !hereIds.has(current.id) &&
    !elsewhere.some((person) => person.id === current.id)
  ) {
    groups.push({ label: "Assigned now", people: [named(current)] });
  }
  if (here.length > 0) {
    groups.push({
      label: buildingName ? `Assigned to ${buildingName}` : "Assigned to this building",
      people: here.map(named),
    });
  }
  if (elsewhere.length > 0) {
    groups.push({
      label: here.length > 0 ? "Everyone else" : "Employees",
      people: elsewhere.map(named),
    });
  }
  return groups;
}
