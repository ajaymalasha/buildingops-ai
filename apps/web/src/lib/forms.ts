import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { fieldErrors, problemMessage } from "@/lib/api/problem";

/**
 * Show an API error on a form. Messages for known fields go to those fields. The return
 * value is a form-level message for anything that could not be placed, or null.
 */
export function applyProblem<Values extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<Values>,
  fields: readonly Path<Values>[],
): string | null {
  const byField = fieldErrors(error);
  let placed = false;
  for (const field of fields) {
    const message = byField[field];
    if (message) {
      setError(field, { type: "server", message });
      placed = true;
    }
  }
  return placed ? null : problemMessage(error);
}

/** Narrow a value from the URL to one of the allowed options. */
export function pick<Option extends string>(
  value: string | undefined,
  allowed: readonly Option[],
): Option | undefined {
  return allowed.find((option) => option === value);
}
