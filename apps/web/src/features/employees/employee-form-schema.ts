import { z } from "zod";

import type { BadgeTone } from "@/components/ui/badge";
import type { components } from "@/lib/api/schema";
import type { Assignment, Employee, EmployeeStatus, EmploymentType } from "@/lib/api/types";
import {
  blankToNull,
  optionalAmount,
  optionalEmail,
  optionalText,
  requiredText,
} from "@/lib/form-fields";

export const EMPLOYEE_STATUSES = ["onboarding", "active", "on_leave", "terminated"] as const;

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  onboarding: "Onboarding",
  active: "Active",
  on_leave: "On leave",
  terminated: "Terminated",
};

export const EMPLOYEE_STATUS_TONES: Record<EmployeeStatus, BadgeTone> = {
  onboarding: "info",
  active: "positive",
  on_leave: "caution",
  terminated: "neutral",
};

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor", "temporary"] as const;

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contractor: "Contractor",
  temporary: "Temporary",
};

export const employeeSchema = z.object({
  first_name: requiredText(100, "Enter their first name."),
  last_name: requiredText(100, "Enter their last name."),
  employee_number: optionalText(20),
  email: optionalEmail,
  phone: optionalText(40),
  job_role_id: z.string().min(1, "Choose a job role."),
  supervisor_id: z.string(),
  employment_type: z.enum(EMPLOYMENT_TYPES),
  status: z.enum(EMPLOYEE_STATUSES),
  hire_date: z.string(),
  termination_date: z.string(),
  hourly_rate: optionalAmount,
  notes: optionalText(5000),
});

export type EmployeeValues = z.infer<typeof employeeSchema>;

export const EMPLOYEE_FIELDS = employeeSchema.keyof().options;

/** The form as it opens: blank for a new employee, or filled in from the one being edited. */
export function employeeDefaults(employee: Employee | null): EmployeeValues {
  return {
    first_name: employee?.first_name ?? "",
    last_name: employee?.last_name ?? "",
    employee_number: employee?.employee_number ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    job_role_id: employee?.job_role.id ?? "",
    supervisor_id: employee?.supervisor?.id ?? "",
    employment_type: employee?.employment_type ?? "full_time",
    status: employee?.status ?? "active",
    hire_date: employee?.hire_date ?? "",
    termination_date: employee?.termination_date ?? "",
    hourly_rate: employee?.hourly_rate ?? "",
    notes: employee?.notes ?? "",
  };
}

/**
 * What is sent to the API. The rate is left out altogether for someone who may not see
 * pay: the API refuses a request that mentions it, since even a blank would erase a figure
 * they cannot see.
 */
export function employeeBody(
  values: EmployeeValues,
  { includeRate }: { includeRate: boolean },
): components["schemas"]["EmployeeCreate"] {
  return {
    first_name: values.first_name,
    last_name: values.last_name,
    employee_number: blankToNull(values.employee_number),
    email: blankToNull(values.email),
    phone: blankToNull(values.phone),
    job_role_id: values.job_role_id,
    supervisor_id: blankToNull(values.supervisor_id),
    employment_type: values.employment_type,
    status: values.status,
    hire_date: blankToNull(values.hire_date),
    termination_date: blankToNull(values.termination_date),
    notes: blankToNull(values.notes),
    ...(includeRate ? { hourly_rate: blankToNull(values.hourly_rate) } : {}),
  };
}

export type SupervisorGroup = { label: string; people: { id: string; name: string }[] };

/**
 * Who the supervisor select offers, grouped by job role.
 *
 * `candidates` are the employees in supervisory roles. People who have left are not
 * offered, and nobody is offered themself. The supervisor already saved on `employee` is
 * always kept, in a group of their own if they would otherwise be missing, so that opening
 * the form and saving it changes nothing.
 */
export function supervisorGroups(
  candidates: readonly Employee[],
  employee: Employee | null,
): SupervisorGroup[] {
  const current = employee?.supervisor ?? null;
  const byRole = new Map<string, SupervisorGroup>();
  let hasCurrent = false;
  for (const candidate of candidates) {
    if (candidate.id === employee?.id) continue;
    if (candidate.id === current?.id) hasCurrent = true;
    else if (candidate.status === "terminated") continue;
    const group = byRole.get(candidate.job_role.id) ?? {
      label: candidate.job_role.name,
      people: [],
    };
    group.people.push({ id: candidate.id, name: candidate.full_name });
    byRole.set(candidate.job_role.id, group);
  }
  const groups = [...byRole.values()].sort((a, b) => a.label.localeCompare(b.label));
  if (current && !hasCurrent) {
    groups.unshift({
      label: "Current supervisor",
      people: [{ id: current.id, name: current.full_name }],
    });
  }
  return groups;
}

// --- building assignments ------------------------------------------------------------------

/**
 * An employee's assignments as the drawer lists them: the open ones with the primary
 * building first, then the ones that have ended. Within that, the API's order is kept
 * (most recent first).
 */
export function splitAssignments(assignments: readonly Assignment[]): {
  current: Assignment[];
  past: Assignment[];
} {
  const open = assignments.filter((assignment) => assignment.ends_on === null);
  return {
    current: [
      ...open.filter((assignment) => assignment.is_primary),
      ...open.filter((assignment) => !assignment.is_primary),
    ],
    past: assignments.filter((assignment) => assignment.ends_on !== null),
  };
}

export const assignSchema = z.object({
  building_id: z.string().min(1, "Choose a building."),
  starts_on: z.string().min(1, "Choose the first day."),
  is_primary: z.boolean(),
});

export type AssignValues = z.infer<typeof assignSchema>;

export const endAssignmentSchema = z.object({
  ends_on: z.string().min(1, "Choose the last day."),
});

export type EndAssignmentValues = z.infer<typeof endAssignmentSchema>;
