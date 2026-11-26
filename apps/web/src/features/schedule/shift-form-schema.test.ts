import { describe, expect, it } from "vitest";

import type { Shift } from "@/lib/api/types";

import {
  changedShiftBody,
  endsNextDay,
  newShiftBody,
  shiftDefaults,
  shiftInstants,
  shiftSchema,
} from "./shift-form-schema";

const NEW_YORK = "America/New_York";
const TOWER = { id: "building-1", name: "Calloway Tower" };
const WHERE = { buildingId: TOWER.id, timeZone: NEW_YORK };

const maya = { id: "employee-1", full_name: "Maya Castellano", employee_number: "EMP-0092" };

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

describe("the shift form", () => {
  it("opens a new shift as a day shift of eight hours with half an hour's break", () => {
    expect(shiftDefaults(null, { timeZone: NEW_YORK, date: "2026-11-26" })).toEqual({
      employee_id: "",
      date: "2026-11-26",
      starts_at: "08:00",
      ends_at: "16:30",
      break_minutes: "30",
      notes: "",
    });
  });

  it("opens a saved shift on the organization's clocks, on the day it starts", () => {
    expect(shiftDefaults(mondayEvening, { timeZone: NEW_YORK, date: "2026-11-26" })).toEqual({
      employee_id: "employee-1",
      date: "2026-11-23",
      starts_at: "17:00",
      ends_at: "01:30",
      break_minutes: "30",
      notes: "",
    });
  });

  it("asks who, on which day and from when to when", () => {
    const result = shiftSchema.safeParse({
      employee_id: "",
      date: "",
      starts_at: "",
      ends_at: "",
      break_minutes: "half an hour",
      notes: "",
    });

    expect(result.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ["employee_id", "Choose who works the shift."],
      ["date", "Choose the day the shift starts."],
      ["starts_at", "Enter the time the shift starts."],
      ["ends_at", "Enter the time the shift ends."],
      ["break_minutes", "Enter a whole number of minutes."],
    ]);
  });

  it("takes an end at or before the start as the next day's", () => {
    expect(endsNextDay({ starts_at: "17:00", ends_at: "01:30" })).toBe(true);
    expect(endsNextDay({ starts_at: "09:00", ends_at: "17:00" })).toBe(false);
    // The same time both ends is a full day, not no time at all.
    expect(endsNextDay({ starts_at: "07:00", ends_at: "07:00" })).toBe(true);
    // Nothing to say until both times are in.
    expect(endsNextDay({ starts_at: "17:00", ends_at: "" })).toBe(false);
  });

  it("turns the day and the clock times into the instants the API takes", () => {
    expect(
      shiftInstants({ date: "2026-11-26", starts_at: "09:00", ends_at: "17:00" }, NEW_YORK),
    ).toEqual({ starts_at: "2026-11-26T14:00:00.000Z", ends_at: "2026-11-26T22:00:00.000Z" });
    // Past midnight: the end is on the next day.
    expect(
      shiftInstants({ date: "2026-11-26", starts_at: "17:00", ends_at: "01:30" }, NEW_YORK),
    ).toEqual({ starts_at: "2026-11-26T22:00:00.000Z", ends_at: "2026-11-27T06:30:00.000Z" });
    // Across a month end, in summer time.
    expect(
      shiftInstants({ date: "2026-07-31", starts_at: "22:00", ends_at: "06:00" }, NEW_YORK),
    ).toEqual({ starts_at: "2026-08-01T02:00:00.000Z", ends_at: "2026-08-01T10:00:00.000Z" });
    expect(shiftInstants({ date: "", starts_at: "09:00", ends_at: "17:00" }, NEW_YORK)).toBeNull();
    expect(
      shiftInstants({ date: "2026-11-26", starts_at: "09:00", ends_at: "" }, NEW_YORK),
    ).toBeNull();
  });

  it("gets a night shift right when the clocks change during it", () => {
    // Clocks go back on November 1, 2026: ten to six that night is nine hours long.
    expect(
      shiftInstants({ date: "2026-10-31", starts_at: "22:00", ends_at: "06:00" }, NEW_YORK),
    ).toEqual({ starts_at: "2026-11-01T02:00:00.000Z", ends_at: "2026-11-01T11:00:00.000Z" });
    // Clocks go forward on March 8, 2026: the same shift is seven hours long.
    expect(
      shiftInstants({ date: "2026-03-07", starts_at: "22:00", ends_at: "06:00" }, NEW_YORK),
    ).toEqual({ starts_at: "2026-03-08T03:00:00.000Z", ends_at: "2026-03-08T10:00:00.000Z" });
  });

  it("sends a new shift with its building, its instants and its break as a number", () => {
    const values = shiftSchema.parse({
      employee_id: "employee-1",
      date: "2026-11-26",
      starts_at: "09:00",
      ends_at: "17:00",
      break_minutes: "",
      notes: "  Covering the lobby. ",
    });

    expect(newShiftBody(values, WHERE)).toEqual({
      employee_id: "employee-1",
      building_id: "building-1",
      starts_at: "2026-11-26T14:00:00.000Z",
      ends_at: "2026-11-26T22:00:00.000Z",
      break_minutes: 0, // left blank: no break
      notes: "Covering the lobby.",
    });
  });

  it("leaves a shift where it is when only something else about it changed", () => {
    const opened = shiftDefaults(mondayEvening, { timeZone: NEW_YORK, date: "2026-11-26" });

    const body = changedShiftBody(
      { ...opened, break_minutes: "45", notes: "Long break." },
      opened,
      WHERE,
    );

    expect(body).toEqual({
      employee_id: "employee-1",
      building_id: "building-1",
      break_minutes: 45,
      notes: "Long break.",
    });
  });

  it("moves a shift when its day or either of its times changed", () => {
    const opened = shiftDefaults(mondayEvening, { timeZone: NEW_YORK, date: "2026-11-26" });

    expect(changedShiftBody({ ...opened, date: "2026-11-24" }, opened, WHERE)).toMatchObject({
      starts_at: "2026-11-24T22:00:00.000Z",
      ends_at: "2026-11-25T06:30:00.000Z",
    });
    expect(changedShiftBody({ ...opened, ends_at: "23:00" }, opened, WHERE)).toMatchObject({
      starts_at: "2026-11-23T22:00:00.000Z",
      ends_at: "2026-11-24T04:00:00.000Z",
    });
  });

  it("does not move a shift that starts in the hour that comes round twice", () => {
    // 1:30 AM, the second time round, on the night the clocks go back.
    const second = shift(maya, "2026-11-01T06:30:00Z", "2026-11-01T14:30:00Z");
    const opened = shiftDefaults(second, { timeZone: NEW_YORK, date: "2026-11-01" });

    // Read back from the clock it would become the first 1:30 AM, an hour earlier.
    expect(opened.starts_at).toBe("01:30");
    expect(
      changedShiftBody({ ...opened, notes: "Stock the closets." }, opened, WHERE),
    ).not.toHaveProperty("starts_at");
  });
});
