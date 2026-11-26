import type { BadgeTone } from "@/components/ui/badge";
import type { DecisionStatus } from "@/lib/api/types";

/**
 * Where a record that waits for approval stands. Timesheets and expenses share the three
 * statuses, and the words and colours for them.
 */
export const DECISION_STATUSES = ["pending", "approved", "rejected"] as const;

export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

// Waiting is the ordinary state of a queue, so it is not an alarm. A rejection is rare.
export const DECISION_STATUS_TONES: Record<DecisionStatus, BadgeTone> = {
  pending: "info",
  approved: "positive",
  rejected: "critical",
};
