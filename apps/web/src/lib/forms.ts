import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { fieldErrors, problemMessage } from "@/lib/api/problem";

/**
 * Show an API error on a form. Messages for known fields go to those fields, and focus
 * moves to the first of them: in a long form it may be scrolled out of sight. The return
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
      setError(field, { type: "server", message }, { shouldFocus: !placed });
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

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Keep a value from the URL only if it has the shape of a record id. */
export function pickId(value: string | undefined): string | undefined {
  return value !== undefined && UUID.test(value) ? value : undefined;
}

type Named = { id: string; name: string };

/**
 * Records as select options. `current` is the record a form was opened with: it stays in
 * the menu even if the list no longer includes it, so the saved value can always be shown.
 */
export function recordOptions(
  records: readonly Named[],
  current?: Named | null,
): { value: string; label: string }[] {
  const options = records.map((record) => ({ value: record.id, label: record.name }));
  if (current && !records.some((record) => record.id === current.id)) {
    options.unshift({ value: current.id, label: current.name });
  }
  return options;
}

/** The entries of a label map as select options, in the order the map lists them. */
export function optionsFrom<Value extends string>(
  labels: Record<Value, string>,
): { value: Value; label: string }[] {
  return (Object.entries(labels) as [Value, string][]).map(([value, label]) => ({ value, label }));
}
