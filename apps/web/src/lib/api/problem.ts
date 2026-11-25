import type { components } from "./schema";

/** The error body every API endpoint returns (RFC 9457 problem document). */
export type Problem = components["schemas"]["Problem"];

export function isProblem(value: unknown): value is Problem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Problem).status === "number" &&
    typeof (value as Problem).code === "string"
  );
}

/** A sentence suitable for showing to the user. */
export function problemMessage(
  error: unknown,
  fallback = "Something went wrong. Try again.",
): string {
  if (isProblem(error)) return error.detail ?? error.title;
  return fallback;
}

/** Field-level messages keyed by field name, for attaching to form inputs. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!isProblem(error) || !error.errors) return {};
  return Object.fromEntries(error.errors.map((item) => [item.field, item.message]));
}
