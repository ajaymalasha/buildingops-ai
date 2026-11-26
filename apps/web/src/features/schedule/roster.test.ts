import { describe, expect, it } from "vitest";

import type { Shift } from "@/lib/api/types";

import {
  buildRoster,
  rosterSummary,
  shiftDay,
  shiftHours,
  shiftMinutes,
  shiftWhen,
} from "./roster";

const NEW_YORK = "America/New_York";
const TOWER = { id: "building-1", name: "Calloway Tower" };

const maya = { id: "employee-1", full_name: "Maya Castellano", employee_number: "EMP-0092" };
const bo = { id: "employee-2", full_name: "Bo Adams", employee_number: "EMP-0031" };

let counter = 0;

function shift(
  employee: Shift["employee"],
  starts_at: string,
  ends_at: string,
  changes: Partial<Shift> = {},
): Shift {
  counter += 1;
  return {
    id: `shift-${counter}`,
    employee,
    building: TOWER,
    starts_at,
    ends_at,
    break_minutes: 30,
    status: "scheduled",
    notes: null,
    created_at: "2026-11-09T14:00:00Z",
    updated_at: "2026-11-09T14:00:00Z",
    ...changes,
  };
}

// An evening shift in New York: 5:00 PM on Monday, November 23 to 1:30 AM on Tuesday.
const mondayEvening = shift(maya, "2026-11-23T22:00:00Z", "2026-11-24T06:30:00Z");

describe("a week's roster", () => {
  it("has a row for each person with a shift, by name", () => {
    const roster = buildRoster(
      [mondayEvening, shift(bo, "2026-11-24T12:00:00Z", "2026-11-24T20:30:00Z")],
      NEW_YORK,
    );

    expect(roster.map((row) => row.employee.full_name)).toEqual(["Bo Adams", "Maya Castellano"]);
  });

  it("puts a shift under the day it starts on where the organization is", () => {
    const [row] = buildRoster([mondayEvening], NEW_YORK);

    // It ends on Tuesday, and in UTC it starts at 10 PM, but it is Monday's shift.
    expect(Object.keys(row!.days)).toEqual(["2026-11-23"]);
    expect(shiftDay(mondayEvening, NEW_YORK)).toBe("2026-11-23");
    // The same instants are Tuesday morning's shift in Tokyo.
    expect(shiftDay(mondayEvening, "Asia/Tokyo")).toBe("2026-11-24");
  });

  it("lists two shifts on one day earliest first", () => {
    const late = shift(maya, "2026-11-25T22:00:00Z", "2026-11-26T02:00:00Z");
    const early = shift(maya, "2026-11-25T12:00:00Z", "2026-11-25T16:00:00Z");

    const [row] = buildRoster([late, early], NEW_YORK);

    expect(row!.days["2026-11-25"]).toEqual([early, late]);
  });

  it("totals each person's hours for the week, less their breaks", () => {
    const [row] = buildRoster(
      [
        mondayEvening, // 8.5 hours with a 30-minute break
        shift(maya, "2026-11-24T22:00:00Z", "2026-11-25T02:00:00Z", { break_minutes: 0 }), // 4 hours
      ],
      NEW_YORK,
    );

    expect(shiftMinutes(mondayEvening)).toBe(480);
    expect(row!.minutes).toBe(480 + 240);
  });

  it("leaves cancelled shifts off unless asked, and never counts their hours", () => {
    const cancelled = shift(maya, "2026-11-24T22:00:00Z", "2026-11-25T06:30:00Z", {
      status: "cancelled",
    });
    const onlyCancelled = shift(bo, "2026-11-24T12:00:00Z", "2026-11-24T20:30:00Z", {
      status: "cancelled",
    });
    const shifts = [mondayEvening, cancelled, onlyCancelled];

    const hidden = buildRoster(shifts, NEW_YORK);
    // Someone whose only shift was cancelled is not on the roster.
    expect(hidden.map((row) => row.employee.full_name)).toEqual(["Maya Castellano"]);
    expect(Object.keys(hidden[0]!.days)).toEqual(["2026-11-23"]);

    const shown = buildRoster(shifts, NEW_YORK, { showCancelled: true });
    expect(shown.map((row) => row.employee.full_name)).toEqual(["Bo Adams", "Maya Castellano"]);
    expect(shown[1]!.days["2026-11-24"]).toEqual([cancelled]);
    // Shown, but still not hours anyone is working.
    expect(shown.map((row) => row.minutes)).toEqual([0, 480]);
  });

  it("counts a missed shift: it was on the schedule, and nobody came", () => {
    const missed = shift(maya, "2026-11-20T22:00:00Z", "2026-11-21T06:30:00Z", {
      status: "missed",
    });

    expect(buildRoster([missed], NEW_YORK)[0]!.minutes).toBe(480);
  });

  it("counts the hours really worked on a night when the clocks change", () => {
    // 10 PM to 6 AM is eight hours, nine when the clocks go back and seven when they go forward.
    const fallBack = shift(maya, "2026-11-01T02:00:00Z", "2026-11-01T11:00:00Z", {
      break_minutes: 0,
    });
    const springForward = shift(maya, "2026-03-08T03:00:00Z", "2026-03-08T10:00:00Z", {
      break_minutes: 0,
    });

    expect(shiftHours(fallBack, NEW_YORK)).toBe("10:00 PM – 6:00 AM");
    expect(shiftMinutes(fallBack)).toBe(9 * 60);
    expect(shiftHours(springForward, NEW_YORK)).toBe("10:00 PM – 6:00 AM");
    expect(shiftMinutes(springForward)).toBe(7 * 60);
  });

  it("names a shift by its day and its hours on the organization's clocks", () => {
    expect(shiftHours(mondayEvening, NEW_YORK)).toBe("5:00 PM – 1:30 AM");
    expect(shiftWhen(mondayEvening, NEW_YORK)).toBe("Mon, Nov 23, 5:00 PM – 1:30 AM");
  });

  it("is empty for a week with no shifts", () => {
    expect(buildRoster([], NEW_YORK)).toEqual([]);
  });
});

describe("what a roster adds up to", () => {
  const tuesday = shift(bo, "2026-11-24T12:00:00Z", "2026-11-24T20:30:00Z");
  const cancelled = shift(maya, "2026-11-24T22:00:00Z", "2026-11-25T06:30:00Z", {
    status: "cancelled",
  });

  it("counts the people, their shifts and their hours", () => {
    expect(rosterSummary(buildRoster([mondayEvening, tuesday], NEW_YORK))).toBe(
      "2 people, 2 shifts, 16 h scheduled",
    );
    expect(rosterSummary(buildRoster([mondayEvening], NEW_YORK))).toBe(
      "1 person, 1 shift, 8 h scheduled",
    );
  });

  it("counts cancelled shifts apart, so the shifts and the hours agree", () => {
    const shifts = [mondayEvening, tuesday, cancelled];

    expect(rosterSummary(buildRoster(shifts, NEW_YORK))).toBe("2 people, 2 shifts, 16 h scheduled");
    expect(rosterSummary(buildRoster(shifts, NEW_YORK, { showCancelled: true }))).toBe(
      "2 people, 2 shifts, 16 h scheduled, plus 1 cancelled",
    );
  });

  it("still lists someone whose only shift was cancelled, with nothing scheduled", () => {
    expect(rosterSummary(buildRoster([cancelled], NEW_YORK, { showCancelled: true }))).toBe(
      "1 person, 0 shifts, 0 h scheduled, plus 1 cancelled",
    );
  });
});
