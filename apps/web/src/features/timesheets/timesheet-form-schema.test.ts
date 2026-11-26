import { describe, expect, it } from "vitest";

import type { Timesheet, TimesheetSummary } from "@/lib/api/types";
import { keepSelected, toggleAll } from "@/lib/selection";

import {
  isSelectable,
  tabStatus,
  tabTotals,
  timesheetBody,
  timesheetDefaults,
  timesheetSchema,
  totalHours,
} from "./timesheet-form-schema";

function timesheet(id: string, changes: Partial<Timesheet> = {}): Timesheet {
  return {
    id,
    employee: { id: "employee-1", full_name: "Maya Castellano", employee_number: "EMP-0092" },
    building: { id: "building-1", name: "Calloway Tower" },
    contract: {
      id: "contract-1",
      contract_number: "CTR-0001",
      name: "Janitorial Services Agreement",
    },
    shift_id: null,
    work_date: "2026-11-25",
    hours_regular: "8.00",
    hours_overtime: "0.00",
    overtime_multiplier: "1.50",
    hourly_rate: "19.50",
    labor_cost: "156.00",
    status: "pending",
    source: "manual",
    notes: null,
    submitted_at: "2026-11-26T02:10:00Z",
    decided_by_name: null,
    decided_at: null,
    rejection_reason: null,
    created_at: "2026-11-26T02:10:00Z",
    updated_at: "2026-11-26T02:10:00Z",
    ...changes,
  };
}

describe("the halves of the approval queue", () => {
  const summary: TimesheetSummary = {
    pending: {
      count: 263,
      hours_regular: "2010.50",
      hours_overtime: "31.25",
      hours_total: "2041.75",
    },
    approved: {
      count: 18227,
      hours_regular: "141000.00",
      hours_overtime: "2200.10",
      hours_total: "143200.10",
    },
    rejected: {
      count: 222,
      hours_regular: "1700.00",
      hours_overtime: "20.15",
      hours_total: "1720.15",
    },
  };

  it("asks the API for one status, or for all of them", () => {
    expect(tabStatus("pending")).toBe("pending");
    expect(tabStatus("approved")).toBe("approved");
    expect(tabStatus("rejected")).toBe("rejected");
    expect(tabStatus("all")).toBeUndefined();
  });

  it("counts each tab from the summary, and all of them together exactly", () => {
    expect(tabTotals(summary)).toEqual({
      pending: { count: 263, hours: "2041.75" },
      approved: { count: 18227, hours: "143200.10" },
      rejected: { count: 222, hours: "1720.15" },
      all: { count: 18712, hours: "146962.00" },
    });
  });

  it("has nothing in any tab when there are no timesheets", () => {
    const none = { count: 0, hours_regular: "0.00", hours_overtime: "0.00", hours_total: "0.00" };

    expect(tabTotals({ pending: none, approved: none, rejected: none }).all).toEqual({
      count: 0,
      hours: "0.00",
    });
  });
});

describe("choosing timesheets to approve together", () => {
  const pending = timesheet("a");
  const overtime = timesheet("b", { hours_regular: "7.50", hours_overtime: "1.25" });
  const approved = timesheet("c", { status: "approved" });
  const rejected = timesheet("d", { status: "rejected" });
  const page = [pending, overtime, approved, rejected];

  it("only lets a pending timesheet be ticked", () => {
    expect(page.filter(isSelectable).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("ticks every pending timesheet on the page at once, and no decided one", () => {
    const pendingIds = page.filter(isSelectable).map((item) => item.id);

    const all = toggleAll(new Set(), pendingIds);
    expect([...all]).toEqual(["a", "b"]);
    expect([...toggleAll(all, pendingIds)]).toEqual([]);
  });

  it("forgets a ticked timesheet once it is no longer pending or no longer on the page", () => {
    const ticked = new Set(["a", "b", "from-another-page"]);
    // "b" was approved by someone else since it was ticked.
    const now = [pending, { ...overtime, status: "approved" as const }, approved];

    expect(
      keepSelected(
        ticked,
        now.filter(isSelectable).map((item) => item.id),
      ),
    ).toEqual(["a"]);
  });

  it("adds up the hours of what is ticked, regular and overtime together", () => {
    expect(totalHours([pending, overtime])).toBe("16.75");
    expect(totalHours([pending])).toBe("8.00");
    expect(totalHours([])).toBe("0.00");
    // Tenths of an hour do not drift, as they would in floating point.
    expect(
      totalHours([
        timesheet("x", { hours_regular: "0.10" }),
        timesheet("y", { hours_regular: "0.20" }),
      ]),
    ).toBe("0.30");
  });
});

describe("the timesheet form", () => {
  it("opens a new timesheet blank, for today where the organization is", () => {
    expect(timesheetDefaults(null, { today: "2026-11-26" })).toEqual({
      employee_id: "",
      building_id: "",
      contract_id: "",
      work_date: "2026-11-26",
      hours_regular: "",
      hours_overtime: "",
      notes: "",
    });
  });

  it("opens a pending timesheet with what is on record, and no overtime as an empty box", () => {
    expect(timesheetDefaults(timesheet("a"), { today: "2026-11-26" })).toEqual({
      employee_id: "employee-1",
      building_id: "building-1",
      contract_id: "contract-1",
      work_date: "2026-11-25",
      hours_regular: "8.00",
      hours_overtime: "",
      notes: "",
    });
    expect(
      timesheetDefaults(timesheet("b", { hours_overtime: "1.25" }), { today: "2026-11-26" })
        .hours_overtime,
    ).toBe("1.25");
  });

  it("asks who, where, when and how long before anything is sent", () => {
    const result = timesheetSchema.safeParse({
      ...timesheetDefaults(null, { today: "2026-11-26" }),
      work_date: "",
      hours_overtime: "a bit",
    });

    expect(result.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ["employee_id", "Choose whose time this is."],
      ["building_id", "Choose the building they worked at."],
      ["work_date", "Choose the day they worked."],
      ["hours_regular", "Enter the regular hours worked."],
      ["hours_overtime", "Enter hours such as 7.5."],
    ]);
  });

  it("sends the hours as text, and no overtime as zero", () => {
    const values = timesheetSchema.parse({
      ...timesheetDefaults(null, { today: "2026-11-26" }),
      employee_id: "employee-1",
      building_id: "building-1",
      hours_regular: " 7.5 ",
      notes: "  Covered the lobby. ",
    });

    expect(timesheetBody(values, { includeContract: true })).toEqual({
      employee_id: "employee-1",
      building_id: "building-1",
      contract_id: null,
      work_date: "2026-11-26",
      hours_regular: "7.5",
      hours_overtime: "0",
      notes: "Covered the lobby.",
    });
  });

  it("never sends a rate, a multiplier or a cost: what time costs is worked out by the API", () => {
    const values = timesheetDefaults(timesheet("b", { hours_overtime: "1.25" }), {
      today: "2026-11-26",
    });

    const body = timesheetBody(values, { includeContract: true });

    expect(Object.keys(body).sort()).toEqual([
      "building_id",
      "contract_id",
      "employee_id",
      "hours_overtime",
      "hours_regular",
      "notes",
      "work_date",
    ]);
    for (const field of ["hourly_rate", "labor_cost", "overtime_multiplier", "status"]) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it("does not mention the contract for someone who may not read contracts", () => {
    const values = timesheetDefaults(timesheet("a"), { today: "2026-11-26" });

    // A null here would take the time off the contract it is booked to.
    expect(timesheetBody(values, { includeContract: false })).not.toHaveProperty("contract_id");
    expect(timesheetBody(values, { includeContract: true }).contract_id).toBe("contract-1");
  });
});
