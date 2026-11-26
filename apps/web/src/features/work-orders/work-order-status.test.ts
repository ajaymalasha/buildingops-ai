import { describe, expect, it } from "vitest";

import type { WorkOrderStatus } from "@/lib/api/types";

import {
  activitySummary,
  ALLOWED_MOVES,
  BACKLOG_STATUSES,
  statusMoves,
  viewStatuses,
  WORK_ORDER_STATUSES,
} from "./work-order-status";

// The table the API enforces (`ALLOWED_MOVES` in its work order service), written out
// again by hand. A change to the web's table shows up here. A change to the API's does
// not until it is copied here, and until then the API simply refuses the move.
const THE_API_ALLOWS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  open: ["scheduled", "in_progress", "on_hold", "cancelled"],
  scheduled: ["in_progress", "on_hold", "cancelled", "open"],
  in_progress: ["on_hold", "completed", "cancelled"],
  on_hold: ["open", "scheduled", "in_progress", "cancelled"],
  completed: ["in_progress"],
  cancelled: ["open"],
};

describe("moving a work order on", () => {
  it.each(WORK_ORDER_STATUSES)("offers exactly the moves the API allows from %s", (status) => {
    const offered = statusMoves(status).map((move) => move.to);

    expect([...offered].sort()).toEqual([...THE_API_ALLOWS[status]].sort());
    expect(new Set(offered).size).toBe(offered.length); // each move once
    expect(offered).not.toContain(status); // never to where it already is
  });

  it("covers every status, and nothing is offered that is not one", () => {
    expect(Object.keys(ALLOWED_MOVES).sort()).toEqual([...WORK_ORDER_STATUSES].sort());
  });

  it("does not offer what the API would refuse", () => {
    const offered = (status: WorkOrderStatus) => statusMoves(status).map((move) => move.to);

    // Work has to start before it can be finished.
    expect(offered("open")).not.toContain("completed");
    expect(offered("scheduled")).not.toContain("completed");
    expect(offered("on_hold")).not.toContain("completed");
    // Finished work can only be taken up again. It cannot be cancelled or put on hold.
    expect(offered("completed")).toEqual(["in_progress"]);
    // A cancelled order comes back as open, not straight into work.
    expect(offered("cancelled")).toEqual(["open"]);
  });

  it("puts the next step of live work first, and cancelling last", () => {
    expect(statusMoves("open").map((move) => move.label)).toEqual([
      "Start work",
      "Schedule",
      "Put on hold",
      "Cancel work order",
    ]);
    expect(statusMoves("scheduled").map((move) => move.label)).toEqual([
      "Start work",
      "Put on hold",
      "Return to open",
      "Cancel work order",
    ]);
    expect(statusMoves("in_progress").map((move) => move.label)).toEqual([
      "Complete",
      "Put on hold",
      "Cancel work order",
    ]);
    expect(statusMoves("on_hold").map((move) => move.label)).toEqual([
      "Resume work",
      "Schedule",
      "Return to open",
      "Cancel work order",
    ]);
  });

  it("calls the one way back from finished or cancelled work reopening", () => {
    expect(statusMoves("completed")).toEqual([{ to: "in_progress", label: "Reopen" }]);
    expect(statusMoves("cancelled")).toEqual([{ to: "open", label: "Reopen" }]);
  });
});

describe("the views of the work order list", () => {
  it("opens on the live backlog: everything on which work is still expected", () => {
    expect(viewStatuses("backlog")).toEqual(["open", "scheduled", "in_progress", "on_hold"]);
    expect(viewStatuses("backlog")).toEqual([...BACKLOG_STATUSES]);
  });

  it("shows finished work on its own, and cancelled work only among all of it", () => {
    expect(viewStatuses("completed")).toEqual(["completed"]);
    // No status at all asks the API for every one, cancelled included.
    expect(viewStatuses("all")).toBeUndefined();
  });
});

describe("a work order's history", () => {
  const change = (from: WorkOrderStatus | null, to: WorkOrderStatus, body: string | null = null) =>
    activitySummary({ kind: "status_change", from_status: from, to_status: to, body });

  it("names a change of status for what happened", () => {
    expect(change("open", "scheduled").title).toBe("Scheduled");
    expect(change("open", "in_progress").title).toBe("Work started");
    expect(change("scheduled", "in_progress").title).toBe("Work started");
    expect(change("in_progress", "on_hold").title).toBe("Put on hold");
    expect(change("on_hold", "in_progress").title).toBe("Work resumed");
    expect(change("in_progress", "completed").title).toBe("Completed");
    expect(change("completed", "in_progress").title).toBe("Reopened");
    expect(change("open", "cancelled").title).toBe("Cancelled");
    expect(change("cancelled", "open").title).toBe("Reopened");
    expect(change("scheduled", "open").title).toBe("Returned to open");
    expect(change("on_hold", "open").title).toBe("Returned to open");
  });

  it("keeps what was said with a change of status, and says nothing when nothing was", () => {
    expect(change("in_progress", "on_hold", "Waiting for parts.")).toEqual({
      title: "Put on hold",
      note: "Waiting for parts.",
    });
    expect(change("open", "in_progress").note).toBeNull();
  });

  it("heads a change of assignee or vendor with the sentence the API recorded", () => {
    const assignment = (body: string | null) =>
      activitySummary({ kind: "assignment", from_status: null, to_status: null, body });

    expect(assignment("Assigned to Luis Ortega.")).toEqual({
      title: "Assigned to Luis Ortega",
      note: null,
    });
    expect(
      assignment("Vendor changed from Tallow Creek Plumbing to Ironclad Door & Lock.").title,
    ).toBe("Vendor changed from Tallow Creek Plumbing to Ironclad Door & Lock");
    expect(assignment(null).title).toBe("Assignment changed");
  });

  it("shows a comment under a heading that says it is one", () => {
    expect(
      activitySummary({
        kind: "comment",
        from_status: null,
        to_status: null,
        body: "The work area is taped off for now.",
      }),
    ).toEqual({ title: "Comment", note: "The work area is taped off for now." });
  });
});
