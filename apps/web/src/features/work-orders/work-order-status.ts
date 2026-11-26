import type { BadgeTone } from "@/components/ui/badge";
import type { WorkOrderActivity, WorkOrderStatus } from "@/lib/api/types";

export const WORK_ORDER_STATUSES = [
  "open",
  "scheduled",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
] as const;

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: "Open",
  scheduled: "Scheduled",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

// The four statuses of the backlog are told apart at a glance: nothing has happened yet, a
// visit is booked, someone is on it, it is stuck.
export const WORK_ORDER_STATUS_TONES: Record<WorkOrderStatus, BadgeTone> = {
  open: "neutral",
  scheduled: "info",
  in_progress: "brand",
  on_hold: "caution",
  completed: "positive",
  cancelled: "neutral",
};

// --- the views of the list -----------------------------------------------------------------

export const WORK_ORDER_VIEWS = ["backlog", "completed", "all"] as const;

export type WorkOrderView = (typeof WORK_ORDER_VIEWS)[number];

export const WORK_ORDER_VIEW_LABELS: Record<WorkOrderView, string> = {
  backlog: "Backlog",
  completed: "Completed",
  all: "All",
};

/** The statuses in which work is still expected. */
export const BACKLOG_STATUSES: readonly WorkOrderStatus[] = [
  "open",
  "scheduled",
  "in_progress",
  "on_hold",
];

/**
 * The statuses a view of the list asks the API for. Undefined asks for every status,
 * cancelled work orders included: they are in none of the other views.
 */
export function viewStatuses(view: WorkOrderView): WorkOrderStatus[] | undefined {
  if (view === "backlog") return [...BACKLOG_STATUSES];
  if (view === "completed") return ["completed"];
  return undefined;
}

// --- moving a work order on ----------------------------------------------------------------

/**
 * Where a work order can go from each status, the likeliest move first.
 *
 * The API holds the rule (`ALLOWED_MOVES` in its work order service) and refuses any other
 * move with a 409. This copy only decides which buttons to offer, so that nobody is
 * offered a move that would be refused.
 */
export const ALLOWED_MOVES: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  open: ["in_progress", "scheduled", "on_hold", "cancelled"],
  scheduled: ["in_progress", "on_hold", "open", "cancelled"],
  in_progress: ["completed", "on_hold", "cancelled"],
  on_hold: ["in_progress", "scheduled", "open", "cancelled"],
  completed: ["in_progress"],
  cancelled: ["open"],
};

export type StatusMove = {
  to: WorkOrderStatus;
  /** What the button says: the move as something to do. */
  label: string;
};

function moveLabel(from: WorkOrderStatus, to: WorkOrderStatus): string {
  switch (to) {
    case "scheduled":
      return "Schedule";
    case "in_progress":
      if (from === "completed") return "Reopen";
      return from === "on_hold" ? "Resume work" : "Start work";
    case "on_hold":
      return "Put on hold";
    case "completed":
      return "Complete";
    case "cancelled":
      return "Cancel work order";
    case "open":
      return from === "cancelled" ? "Reopen" : "Return to open";
  }
}

/** The moves to offer for a work order in `status`, in the order to offer them. */
export function statusMoves(status: WorkOrderStatus): StatusMove[] {
  return ALLOWED_MOVES[status].map((to) => ({ to, label: moveLabel(status, to) }));
}

// --- the history ---------------------------------------------------------------------------

type Change = Pick<WorkOrderActivity, "kind" | "body" | "from_status" | "to_status">;

function statusChangeTitle(from: WorkOrderStatus | null, to: WorkOrderStatus): string {
  switch (to) {
    case "scheduled":
      return "Scheduled";
    case "in_progress":
      if (from === "completed") return "Reopened";
      return from === "on_hold" ? "Work resumed" : "Work started";
    case "on_hold":
      return "Put on hold";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "open":
      return from === "cancelled" ? "Reopened" : "Returned to open";
  }
}

/**
 * How an entry of a work order's history is headed, and what was said with it.
 *
 * A change of status is named for what happened ("Work started"), with the comment made
 * at the time under it. A change of assignee or vendor is the sentence the API recorded.
 * A comment is headed as one, with its text under it.
 */
export function activitySummary(activity: Change): { title: string; note: string | null } {
  if (activity.kind === "status_change" && activity.to_status) {
    return {
      title: statusChangeTitle(activity.from_status, activity.to_status),
      note: activity.body,
    };
  }
  if (activity.kind === "assignment") {
    // Recorded as a sentence. As a heading it stands without its full stop.
    return { title: (activity.body ?? "Assignment changed").replace(/\.$/, ""), note: null };
  }
  return { title: "Comment", note: activity.body };
}
