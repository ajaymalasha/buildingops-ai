import { z } from "zod";

import type { components } from "@/lib/api/schema";
import type { JobRole } from "@/lib/api/types";
import { blankToNull, optionalAmount, optionalText, requiredText } from "@/lib/form-fields";

export const jobRoleSchema = z.object({
  name: requiredText(120, "Enter the role's name."),
  description: optionalText(5000),
  default_hourly_rate: optionalAmount,
  is_supervisory: z.boolean(),
});

export type JobRoleValues = z.infer<typeof jobRoleSchema>;

export const JOB_ROLE_FIELDS = jobRoleSchema.keyof().options;

/** The form as it opens: blank for a new role, or filled in from the one being edited. */
export function jobRoleDefaults(jobRole: JobRole | null): JobRoleValues {
  return {
    name: jobRole?.name ?? "",
    description: jobRole?.description ?? "",
    default_hourly_rate: jobRole?.default_hourly_rate ?? "",
    is_supervisory: jobRole?.is_supervisory ?? false,
  };
}

/**
 * What is sent to the API. The rate is left out altogether for someone who may not see
 * pay: the API refuses a request that mentions it, since even a blank would erase a figure
 * they cannot see.
 */
export function jobRoleBody(
  values: JobRoleValues,
  { includeRate }: { includeRate: boolean },
): components["schemas"]["JobRoleCreate"] {
  return {
    name: values.name,
    description: blankToNull(values.description),
    is_supervisory: values.is_supervisory,
    ...(includeRate ? { default_hourly_rate: blankToNull(values.default_hourly_rate) } : {}),
  };
}
