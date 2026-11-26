import { describe, expect, it } from "vitest";

import { daysBetween } from "@/lib/dates";

import {
  adjustRange,
  DEFAULT_PERIOD,
  isPeriod,
  MAX_PERIOD_DAYS,
  PERIOD_CHOICES,
  PERIOD_LABELS,
  periodFromParams,
  periodParams,
  presetRange,
} from "./dashboard-period";

const TODAY = "2026-11-26";

describe("the presets", () => {
  it("cover the days their names say, as of today", () => {
    expect(presetRange("this_month", TODAY)).toEqual({ from: "2026-11-01", to: "2026-11-26" });
    expect(presetRange("last_month", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("this_quarter", TODAY)).toEqual({ from: "2026-10-01", to: "2026-11-26" });
    expect(presetRange("year_to_date", TODAY)).toEqual({ from: "2026-01-01", to: "2026-11-26" });
    // This month so far and the eleven before it: twelve months on the calendar.
    expect(presetRange("last_12_months", TODAY)).toEqual({ from: "2025-12-01", to: "2026-11-26" });
  });

  it("start and end on the same day on the first day of a month, a quarter and a year", () => {
    const newYear = "2027-01-01";

    expect(presetRange("this_month", newYear)).toEqual({ from: newYear, to: newYear });
    expect(presetRange("this_quarter", newYear)).toEqual({ from: newYear, to: newYear });
    expect(presetRange("year_to_date", newYear)).toEqual({ from: newYear, to: newYear });
    // Last month is last year's December, all of it.
    expect(presetRange("last_month", newYear)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(presetRange("last_12_months", newYear)).toEqual({ from: "2026-02-01", to: newYear });
  });

  it("take months as long as they are", () => {
    // From the last day of March, last month is the whole of February and no more.
    expect(presetRange("last_month", "2026-03-31")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(presetRange("last_month", "2028-03-31")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
    expect(presetRange("this_month", "2028-02-29")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
    expect(presetRange("this_quarter", "2026-06-30")).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
    });
  });

  it("never ask for more than the API answers for", () => {
    for (const today of [TODAY, "2028-02-29", "2027-12-31"]) {
      for (const choice of PERIOD_CHOICES) {
        if (choice === "custom") continue;
        const { from, to } = presetRange(choice, today);
        expect(isPeriod(from, to), `${choice} on ${today}`).toBe(true);
      }
    }
  });

  it("each have a name, and so does a range someone chose", () => {
    expect(PERIOD_CHOICES.map((choice) => PERIOD_LABELS[choice])).toEqual([
      "This month",
      "Last month",
      "This quarter",
      "Year to date",
      "Last 12 months",
      "Custom range",
    ]);
  });
});

describe("the period a URL asks for", () => {
  it("is the last complete month when the URL says nothing", () => {
    expect(DEFAULT_PERIOD).toBe("last_month");
    expect(periodFromParams({}, TODAY)).toEqual({
      choice: "last_month",
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("is the preset the URL names, whatever dates come with it", () => {
    expect(periodFromParams({ period: "year_to_date" }, TODAY)).toEqual({
      choice: "year_to_date",
      from: "2026-01-01",
      to: "2026-11-26",
    });
    expect(
      periodFromParams({ period: "this_month", from: "2020-01-01", to: "2020-01-31" }, TODAY),
    ).toEqual({ choice: "this_month", from: "2026-11-01", to: "2026-11-26" });
  });

  it("is the range the URL gives when it says custom", () => {
    expect(
      periodFromParams({ period: "custom", from: "2026-07-01", to: "2026-09-30" }, TODAY),
    ).toEqual({ choice: "custom", from: "2026-07-01", to: "2026-09-30" });
    // One day is a period.
    expect(
      periodFromParams({ period: "custom", from: "2026-07-04", to: "2026-07-04" }, TODAY),
    ).toEqual({ choice: "custom", from: "2026-07-04", to: "2026-07-04" });
  });

  it.each([
    ["a preset that does not exist", { period: "last_decade" }],
    ["a custom range with no dates", { period: "custom" }],
    ["a custom range with one date", { period: "custom", from: "2026-07-01" }],
    ["a range that runs backwards", { period: "custom", from: "2026-09-30", to: "2026-07-01" }],
    ["a day that does not exist", { period: "custom", from: "2026-02-30", to: "2026-03-31" }],
    ["a range longer than three years", { period: "custom", from: "2023-01-01", to: "2026-06-30" }],
    ["dates with no period to go with them", { from: "2026-07-01", to: "2026-09-30" }],
  ])("falls back to the default for %s", (_label, params) => {
    expect(periodFromParams(params, TODAY)).toEqual({
      choice: "last_month",
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("goes back into the URL with nothing for the default, and dates only for a custom range", () => {
    const current = { from: "2026-10-01", to: "2026-10-31" };

    expect(periodParams("last_month", current)).toEqual({ period: null, from: null, to: null });
    expect(periodParams("this_quarter", current)).toEqual({
      period: "this_quarter",
      from: null,
      to: null,
    });
    // A custom range starts as the days already on show.
    expect(periodParams("custom", current)).toEqual({
      period: "custom",
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });
});

describe("what makes a period", () => {
  it("is two days that exist, in order, no more than three years apart", () => {
    expect(isPeriod("2026-03-01", "2026-03-31")).toBe(true);
    expect(isPeriod("2026-03-01", "2026-03-01")).toBe(true);
    expect(isPeriod("2026-03-02", "2026-03-01")).toBe(false);
    expect(isPeriod("2026-03-01", undefined)).toBe(false);
    expect(isPeriod(undefined, "2026-03-01")).toBe(false);
    expect(isPeriod("March", "2026-03-31")).toBe(false);
    // 1,096 days is three years with a leap day among them. One more is too many.
    expect(MAX_PERIOD_DAYS).toBe(1096);
    expect(isPeriod("2023-03-01", "2026-02-28")).toBe(true);
    expect(isPeriod("2023-03-01", "2026-03-01")).toBe(false);
  });
});

describe("changing one end of a custom range", () => {
  const range = { from: "2026-07-01", to: "2026-09-30" };

  it("moves that end and leaves the other where it is", () => {
    expect(adjustRange(range, { from: "2026-08-15" })).toEqual({
      from: "2026-08-15",
      to: "2026-09-30",
    });
    expect(adjustRange(range, { to: "2026-12-31" })).toEqual({
      from: "2026-07-01",
      to: "2026-12-31",
    });
  });

  it("brings the other end along rather than run backwards", () => {
    expect(adjustRange(range, { from: "2026-10-05" })).toEqual({
      from: "2026-10-05",
      to: "2026-10-05",
    });
    expect(adjustRange(range, { to: "2026-06-10" })).toEqual({
      from: "2026-06-10",
      to: "2026-06-10",
    });
  });

  it("brings the other end along rather than cover more than three years", () => {
    const earlier = adjustRange(range, { from: "2020-01-01" });
    const later = adjustRange(range, { to: "2030-12-31" });

    expect(earlier).toEqual({ from: "2020-01-01", to: "2022-12-31" });
    expect(later).toEqual({ from: "2028-01-01", to: "2030-12-31" });
    for (const adjusted of [earlier, later]) {
      expect(daysBetween(adjusted.from, adjusted.to) + 1).toBe(MAX_PERIOD_DAYS);
      expect(isPeriod(adjusted.from, adjusted.to)).toBe(true);
    }
  });

  it("changes nothing when an end is emptied, or is not a date", () => {
    expect(adjustRange(range, { from: "" })).toEqual(range);
    expect(adjustRange(range, { to: "" })).toEqual(range);
    expect(adjustRange(range, { to: "2026-02-30" })).toEqual(range);
  });
});
