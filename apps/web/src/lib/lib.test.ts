import { describe, expect, it, vi } from "vitest";

import { formatValue } from "@/features/audit/audit-log-page";
import { safeRedirectPath } from "@/features/auth/sign-in";
import {
  addMemberSchema,
  editMemberSchema,
  generatePassword,
} from "@/features/members/member-form-schema";
import { fieldErrors, isProblem, problemMessage } from "@/lib/api/problem";
import {
  addDays,
  daysBetween,
  fromDateTimeInput,
  instantInZone,
  isCalendarDate,
  nextDay,
  startOfDayInZone,
  startOfWeek,
  toDateTimeInput,
  todayInZone,
  weekDays,
  zonedDateTime,
} from "@/lib/dates";
import { isZero, sameDecimal, sumDecimals } from "@/lib/decimal";
import {
  addressBody,
  addressDefaults,
  blankToNull,
  contactBody,
  countryCode,
  optionalAmount,
  optionalEmail,
  optionalHours,
  optionalPercent,
  optionalWholeNumber,
  requiredAmount,
  requiredHours,
  timeOfDay,
  toInteger,
  wholeNumber,
} from "@/lib/form-fields";
import {
  applyProblem,
  contractFilterOptions,
  contractOptions,
  optionsFrom,
  personOptions,
  pick,
  pickDate,
  pickId,
  recordOptions,
} from "@/lib/forms";
import {
  formatDate,
  formatDateTime,
  formatDay,
  formatDayRange,
  formatDuration,
  formatHours,
  formatLongDay,
  formatMoney,
  formatMonthDay,
  formatNumber,
  formatOverdue,
  formatPercent,
  formatPeriod,
  formatQuantity,
  formatRelative,
  formatTime,
  formatWeekday,
  humanize,
  initials,
} from "@/lib/format";
import { breadcrumbsFor, isActivePath, visibleNavigation } from "@/lib/navigation";
import { groupedTimeZones, timeZoneLabel } from "@/lib/regional";
import { keepSelected, selectionState, toggleAll, toggleOne } from "@/lib/selection";

describe("safeRedirectPath", () => {
  it.each([
    ["/settings/members?role=supervisor", "/settings/members?role=supervisor"],
    ["/", "/"],
  ])("keeps a path on this site: %s", (next, expected) => {
    expect(safeRedirectPath(next)).toBe(expected);
  });

  it.each([
    ["an absolute URL", "https://evil.example/phish"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash trick", "/\\evil.example"],
    ["a scheme", "javascript:alert(1)"],
    ["the sign-in page itself", "/login?next=/"],
    ["an API route", "/api/v1/members"],
    ["the session-ended route", "/session/ended"],
    ["nothing", ""],
    ["null", null],
  ])("falls back to the home page for %s", (_label, next) => {
    expect(safeRedirectPath(next)).toBe("/");
  });
});

describe("dates in a time zone", () => {
  it.each([
    ["2026-01-15", "America/New_York", "2026-01-15T05:00:00.000Z"], // EST, UTC-5
    ["2026-07-15", "America/New_York", "2026-07-15T04:00:00.000Z"], // EDT, UTC-4
    ["2026-03-08", "America/New_York", "2026-03-08T05:00:00.000Z"], // clocks change later that day
    ["2026-03-09", "America/New_York", "2026-03-09T04:00:00.000Z"],
    ["2026-11-01", "America/New_York", "2026-11-01T04:00:00.000Z"], // clocks go back that day
    ["2026-06-01", "Asia/Kolkata", "2026-05-31T18:30:00.000Z"], // UTC+5:30
    ["2026-06-01", "UTC", "2026-06-01T00:00:00.000Z"],
  ])("%s starts in %s at %s", (date, zone, expected) => {
    expect(startOfDayInZone(date, zone).toISOString()).toBe(expected);
  });

  it("steps to the next day across month and year ends", () => {
    expect(nextDay("2026-02-28")).toBe("2026-03-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("knows what day it is where the organization is, not where the browser is", () => {
    const now = new Date("2026-11-26T02:30:00Z");

    expect(todayInZone("America/New_York", now)).toBe("2026-11-25"); // still the evening before
    expect(todayInZone("Asia/Kolkata", now)).toBe("2026-11-26");
    expect(todayInZone("UTC", now)).toBe("2026-11-26");
    expect(todayInZone("Pacific/Auckland", new Date("2026-12-31T12:00:00Z"))).toBe("2027-01-01");
  });

  it("counts whole days between calendar dates", () => {
    expect(daysBetween("2026-11-26", "2026-11-26")).toBe(0);
    expect(daysBetween("2026-11-26", "2026-12-26")).toBe(30);
    expect(daysBetween("2026-11-26", "2026-11-08")).toBe(-18);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2); // across a clock change
    expect(daysBetween("2027-12-31", "2028-03-01")).toBe(61); // across a leap day
  });

  it("moves a calendar date forwards and backwards by days", () => {
    expect(addDays("2026-11-26", 7)).toBe("2026-12-03");
    expect(addDays("2026-11-26", -26)).toBe("2026-10-31");
    expect(addDays("2026-12-28", 6)).toBe("2027-01-03");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // a leap year
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09"); // across a clock change
    expect(addDays("2026-11-26", 0)).toBe("2026-11-26");
  });

  it("tells a calendar date that exists from one that only looks like one", () => {
    expect(isCalendarDate("2026-11-26")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    for (const wrong of ["2026-02-30", "2026-13-01", "2026-11-31", "26-11-2026", "tomorrow", ""]) {
      expect(isCalendarDate(wrong)).toBe(false);
    }
  });
});

describe("weeks", () => {
  it("start on Monday, whichever day of them is asked about", () => {
    expect(startOfWeek("2026-11-23")).toBe("2026-11-23"); // a Monday
    expect(startOfWeek("2026-11-26")).toBe("2026-11-23"); // Thursday
    expect(startOfWeek("2026-11-29")).toBe("2026-11-23"); // Sunday, the last day of that week
    expect(startOfWeek("2026-11-30")).toBe("2026-11-30"); // and the Monday after
  });

  it("can start in one month, or one year, and end in the next", () => {
    expect(startOfWeek("2026-12-01")).toBe("2026-11-30");
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28");
    expect(weekDays("2026-12-28")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });

  it("have seven days even when the clocks change in them", () => {
    // Daylight saving starts on Sunday, March 8, 2026 in New York. Dates do not care.
    expect(weekDays(startOfWeek("2026-03-08"))).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ]);
    expect(startOfWeek(addDays("2026-03-02", 7))).toBe("2026-03-09");
  });
});

describe("clock times in a time zone", () => {
  const NEW_YORK = "America/New_York";

  it("reads an instant as the day and the time clocks show there", () => {
    expect(zonedDateTime("2026-11-26T22:00:00Z", NEW_YORK)).toEqual({
      date: "2026-11-26",
      time: "17:00",
    });
    // Late evening in New York is already the next day in UTC.
    expect(zonedDateTime("2026-11-26T04:30:00Z", NEW_YORK)).toEqual({
      date: "2026-11-25",
      time: "23:30",
    });
    // Midnight is 00:00, never 24:00, as a time input needs.
    expect(zonedDateTime("2026-11-26T05:00:00Z", NEW_YORK).time).toBe("00:00");
    expect(zonedDateTime("2026-07-15T13:05:00Z", NEW_YORK)).toEqual({
      date: "2026-07-15",
      time: "09:05",
    });
    expect(zonedDateTime("2026-06-01T03:30:00Z", "Asia/Kolkata")).toEqual({
      date: "2026-06-01",
      time: "09:00",
    });
  });

  it.each([
    ["2026-01-15", "09:00", NEW_YORK, "2026-01-15T14:00:00.000Z"], // EST, UTC-5
    ["2026-07-15", "09:00", NEW_YORK, "2026-07-15T13:00:00.000Z"], // EDT, UTC-4
    ["2026-11-26", "00:00", NEW_YORK, "2026-11-26T05:00:00.000Z"],
    ["2026-11-26", "23:59", NEW_YORK, "2026-11-27T04:59:00.000Z"],
    ["2026-06-01", "09:00", "Asia/Kolkata", "2026-06-01T03:30:00.000Z"], // UTC+5:30
    ["2026-06-01", "09:00", "UTC", "2026-06-01T09:00:00.000Z"],
    ["2026-06-01", "09:00", "Pacific/Auckland", "2026-05-31T21:00:00.000Z"], // UTC+12
  ])("%s at %s in %s is %s", (date, time, zone, expected) => {
    expect(instantInZone(date, time, zone)?.toISOString()).toBe(expected);
  });

  it("gets the day the clocks go forward right, before and after the change", () => {
    // In New York on March 8, 2026, 2:00 AM becomes 3:00 AM.
    expect(instantInZone("2026-03-08", "01:30", NEW_YORK)?.toISOString()).toBe(
      "2026-03-08T06:30:00.000Z", // still EST
    );
    expect(instantInZone("2026-03-08", "03:00", NEW_YORK)?.toISOString()).toBe(
      "2026-03-08T07:00:00.000Z", // already EDT
    );
    expect(instantInZone("2026-03-08", "12:00", NEW_YORK)?.toISOString()).toBe(
      "2026-03-08T16:00:00.000Z",
    );
  });

  it("takes a time in the hour the clocks skip as that long after the hour before", () => {
    // 2:30 AM never appears on a clock that night. Half an hour after 2:00 is 3:30 AM EDT.
    const skipped = instantInZone("2026-03-08", "02:30", NEW_YORK);
    expect(skipped?.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(zonedDateTime(skipped!.toISOString(), NEW_YORK).time).toBe("03:30");
    // The same in the southern spring: Sydney skips 2:00 to 3:00 AM on October 4, 2026.
    expect(instantInZone("2026-10-04", "02:30", "Australia/Sydney")?.toISOString()).toBe(
      "2026-10-03T16:30:00.000Z",
    );
  });

  it("takes a time in the hour that comes round twice as the first time round", () => {
    // In New York on November 1, 2026, 2:00 AM becomes 1:00 AM again.
    expect(instantInZone("2026-11-01", "00:30", NEW_YORK)?.toISOString()).toBe(
      "2026-11-01T04:30:00.000Z",
    );
    expect(instantInZone("2026-11-01", "01:30", NEW_YORK)?.toISOString()).toBe(
      "2026-11-01T05:30:00.000Z", // EDT: the first 1:30 AM
    );
    expect(instantInZone("2026-11-01", "02:00", NEW_YORK)?.toISOString()).toBe(
      "2026-11-01T07:00:00.000Z", // EST
    );
    expect(instantInZone("2026-04-05", "02:30", "Australia/Sydney")?.toISOString()).toBe(
      "2026-04-04T15:30:00.000Z",
    );
  });

  it("cannot tell the two 1:30s of that night apart, so a time nobody changed is not sent back", () => {
    // The second 1:30 AM, in EST, reads the same on the clock as the first.
    const second = "2026-11-01T06:30:00.000Z";
    expect(zonedDateTime(second, NEW_YORK)).toEqual({ date: "2026-11-01", time: "01:30" });
    expect(instantInZone("2026-11-01", "01:30", NEW_YORK)?.toISOString()).not.toBe(second);
  });

  it("makes a night on which the clocks change as long as it really is", () => {
    const at = (date: string, time: string) => instantInZone(date, time, NEW_YORK)!.getTime();
    const hours = (from: number, to: number) => (to - from) / 3_600_000;
    // Ten at night to six in the morning is eight hours on any other night.
    expect(hours(at("2026-11-25", "22:00"), at("2026-11-26", "06:00"))).toBe(8);
    expect(hours(at("2026-03-07", "22:00"), at("2026-03-08", "06:00"))).toBe(7);
    expect(hours(at("2026-10-31", "22:00"), at("2026-11-01", "06:00"))).toBe(9);
  });

  it("refuses a day or a time that does not exist", () => {
    expect(instantInZone("2026-02-30", "09:00", NEW_YORK)).toBeNull();
    expect(instantInZone("2026-11-26", "24:00", NEW_YORK)).toBeNull();
    expect(instantInZone("2026-11-26", "9:00", NEW_YORK)).toBeNull();
    expect(instantInZone("", "", NEW_YORK)).toBeNull();
  });

  it("fills a date-and-time input from an instant and reads one back", () => {
    expect(toDateTimeInput("2026-11-27T14:30:00Z", NEW_YORK)).toBe("2026-11-27T09:30");
    expect(fromDateTimeInput("2026-11-27T09:30", NEW_YORK)?.toISOString()).toBe(
      "2026-11-27T14:30:00.000Z",
    );
    // Some browsers add seconds. They are not part of what was chosen.
    expect(fromDateTimeInput("2026-11-27T09:30:00", NEW_YORK)?.toISOString()).toBe(
      "2026-11-27T14:30:00.000Z",
    );
    expect(fromDateTimeInput("", NEW_YORK)).toBeNull();
    // The seconds an instant carries are not shown, which is why an untouched time is not
    // sent back: it would come back without them.
    expect(toDateTimeInput("2026-11-27T14:30:41.512Z", NEW_YORK)).toBe("2026-11-27T09:30");
  });
});

describe("formatting", () => {
  const instant = "2026-11-25T22:54:00Z";

  it("shows dates and times in the requested zone", () => {
    expect(formatDateTime(instant, "America/New_York")).toBe("Nov 25, 2026, 5:54 PM");
    expect(formatDateTime(instant, "Asia/Tokyo")).toBe("Nov 26, 2026, 7:54 AM");
    expect(formatDate(instant, "Asia/Tokyo")).toBe("Nov 26, 2026");
  });

  it("describes how long ago something happened", () => {
    const now = new Date("2026-11-25T23:00:00Z");
    expect(formatRelative("2026-11-25T22:59:40Z", now)).toBe("just now");
    expect(formatRelative("2026-11-25T22:54:00Z", now)).toBe("6 minutes ago");
    expect(formatRelative("2026-11-25T20:00:00Z", now)).toBe("3 hours ago");
    expect(formatRelative("2026-11-24T23:00:00Z", now)).toBe("yesterday");
    expect(formatRelative("2026-11-02T23:00:00Z", now)).toBe("3 weeks ago");
    expect(formatRelative("2025-11-25T23:00:00Z", now)).toBe("last year");
    expect(formatRelative("2026-11-27T23:00:00Z", now)).toBe("in 2 days");
  });

  it("shows a calendar date as the same day everywhere", () => {
    // A contract that starts on March 1 starts on March 1, whatever zone the reader is in.
    expect(formatDay("2026-03-01")).toBe("Mar 1, 2026");
    expect(formatDay("2026-12-31")).toBe("Dec 31, 2026");
    expect(formatDay("2028-02-29")).toBe("Feb 29, 2028");
  });

  it("shows a time of day in the requested zone", () => {
    expect(formatTime("2026-11-26T22:00:00Z", "America/New_York")).toBe("5:00 PM");
    expect(formatTime("2026-11-26T06:30:00Z", "America/New_York")).toBe("1:30 AM");
    expect(formatTime("2026-11-26T22:00:00Z", "Asia/Tokyo")).toBe("7:00 AM");
  });

  it("names the days of a week for its columns, and in full for reading out", () => {
    expect(formatWeekday("2026-11-23")).toBe("Mon");
    expect(formatWeekday("2026-11-29")).toBe("Sun");
    expect(formatMonthDay("2026-11-23")).toBe("Nov 23");
    expect(formatMonthDay("2027-01-03")).toBe("Jan 3");
    expect(formatLongDay("2026-11-23")).toBe("Monday, November 23");
  });

  it("shows a run of days, saying once what its two ends share", () => {
    expect(formatDayRange("2026-11-23", "2026-11-29")).toBe("Nov 23 – 29, 2026");
    expect(formatDayRange("2026-11-30", "2026-12-06")).toBe("Nov 30 – Dec 6, 2026");
    expect(formatDayRange("2026-12-28", "2027-01-03")).toBe("Dec 28, 2026 – Jan 3, 2027");
    // Ordinary spaces round the dash, so that the text wraps and can be searched for.
    expect(formatDayRange("2026-11-23", "2026-11-29")).not.toMatch(/[\u2009\u202f]/);
  });

  it("calls a billing period by its month when it is exactly one", () => {
    expect(formatPeriod("2026-10-01", "2026-10-31")).toBe("October 2026");
    expect(formatPeriod("2026-02-01", "2026-02-28")).toBe("February 2026");
    expect(formatPeriod("2028-02-01", "2028-02-29")).toBe("February 2028");
    // A contract that started mid-month, or a period of two months, is shown by its ends.
    expect(formatPeriod("2026-10-15", "2026-10-31")).toBe("Oct 15 – 31, 2026");
    expect(formatPeriod("2028-02-01", "2028-02-28")).toBe("Feb 1 – 28, 2028");
    expect(formatPeriod("2026-10-01", "2026-11-30")).toBe("Oct 1 – Nov 30, 2026");
  });

  it("totals minutes as hours, to two places at most", () => {
    expect(formatDuration(2400)).toBe("40 h");
    expect(formatDuration(2250)).toBe("37.5 h");
    expect(formatDuration(500)).toBe("8.33 h");
    expect(formatDuration(0)).toBe("0 h");
    expect(formatDuration(72_000)).toBe("1,200 h");
  });

  it("shows hours to two places and quantities without trailing zeros", () => {
    expect(formatHours("8")).toBe("8.00");
    expect(formatHours("7.5")).toBe("7.50");
    expect(formatHours("1284.50")).toBe("1,284.50");
    expect(formatQuantity("1.00")).toBe("1");
    expect(formatQuantity("1284.50")).toBe("1,284.5");
    expect(formatQuantity("0.25")).toBe("0.25");
  });

  it("says how long something has been overdue", () => {
    expect(formatOverdue("2026-11-20", "2026-11-26")).toBe("6 days overdue");
    expect(formatOverdue("2026-11-25", "2026-11-26")).toBe("1 day overdue");
    expect(formatOverdue("2023-01-01", "2026-11-26")).toBe("1,425 days overdue");
    // Whether it is overdue is the API's call. If it says so on the day itself, so be it.
    expect(formatOverdue("2026-11-26", "2026-11-26")).toBe("1 day overdue");
  });

  it("groups thousands in counts", () => {
    expect(formatNumber(412000)).toBe("412,000");
    expect(formatNumber(7)).toBe("7");
    expect(formatNumber(0)).toBe("0");
  });

  it("shows money from the API's decimal strings, in the currency's own style", () => {
    expect(formatMoney("18400.00", "USD")).toBe("$18,400.00");
    expect(formatMoney("19.5", "USD")).toBe("$19.50");
    expect(formatMoney("0.00", "USD")).toBe("$0.00");
    expect(formatMoney("22900.50", "EUR")).toBe("€22,900.50");
    expect(formatMoney("6800.00", "GBP")).toBe("£6,800.00");
    expect(formatMoney("31250.00", "CAD")).toBe("CA$31,250.00");
    expect(formatMoney("22900", "JPY")).toBe("¥22,900"); // a currency without minor units
  });

  it("never passes an amount through a floating-point number", () => {
    // Doubles cannot hold either of these exactly. The digits must come out as they went in.
    expect(formatMoney("9007199254740993.07", "USD")).toBe("$9,007,199,254,740,993.07");
    expect(formatMoney("1234567890123.45", "USD")).toBe("$1,234,567,890,123.45");
  });

  it("shows a percentage as people say it", () => {
    expect(formatPercent("12.50")).toBe("12.5%");
    expect(formatPercent("15.00")).toBe("15%");
    expect(formatPercent("7.25")).toBe("7.25%");
    expect(formatPercent("0.00")).toBe("0%");
    expect(formatPercent("125.00")).toBe("125%");
  });

  it("shows what it was given when that is not an amount", () => {
    expect(formatMoney("", "USD")).toBe("");
    expect(formatMoney("n/a", "USD")).toBe("n/a");
    expect(formatPercent("twelve")).toBe("twelve");
  });

  it("derives initials", () => {
    expect(initials("Dana Whitfield")).toBe("DW");
    expect(initials("Luis de la Ortega")).toBe("LO");
    expect(initials("cher")).toBe("C");
    expect(initials("   ")).toBe("?");
  });

  it("rewords codes", () => {
    expect(humanize("operations_manager")).toBe("Operations manager");
    expect(humanize("member.role_changed")).toBe("Member role changed");
  });

  it("rewords recorded codes but shows recorded text exactly", () => {
    expect(formatValue("operations_manager")).toBe("Operations manager");
    expect(formatValue("tessa.nguyen@meridianfs.example")).toBe("tessa.nguyen@meridianfs.example");
    expect(formatValue("Regional Manager")).toBe("Regional Manager");
    expect(formatValue("America/New_York")).toBe("America/New_York");
    expect(formatValue(null)).toBe("empty");
    expect(formatValue("")).toBe("empty");
    expect(formatValue(42)).toBe("42");
  });
});

describe("exact arithmetic on decimal strings", () => {
  it("adds amounts without a floating-point number in sight", () => {
    // In floating point, 0.1 + 0.2 is 0.30000000000000004.
    expect(sumDecimals(["0.10", "0.20"])).toBe("0.30");
    expect(sumDecimals(["18400.00", "1250.50", "312.75"])).toBe("19963.25");
    expect(sumDecimals(["9007199254740993.07", "0.01"])).toBe("9007199254740993.08");
    expect(sumDecimals(["0.99", "0.01"])).toBe("1.00");
  });

  it("writes the sum to at least two places, and to as many as its most precise part", () => {
    expect(sumDecimals(["8", "7.5"])).toBe("15.50");
    expect(sumDecimals(["1.005", "2"])).toBe("3.005");
    expect(sumDecimals([])).toBe("0.00");
    expect(sumDecimals(["0"])).toBe("0.00");
  });

  it("handles amounts below zero", () => {
    expect(sumDecimals(["10.00", "-12.50"])).toBe("-2.50");
    expect(sumDecimals(["-0.05", "0.05"])).toBe("0.00");
    expect(sumDecimals(["-0.50", "0.25"])).toBe("-0.25");
  });

  it("gives no sum at all when something is not a number", () => {
    expect(sumDecimals(["10.00", "n/a"])).toBeNull();
    expect(sumDecimals(["1,250.00"])).toBeNull();
    expect(sumDecimals([""])).toBeNull();
    expect(sumDecimals(["1e3"])).toBeNull();
  });

  it("compares numbers, not the way they are written", () => {
    expect(sameDecimal("18400", "18400.00")).toBe(true);
    expect(sameDecimal("0.3", "0.30")).toBe(true);
    expect(sameDecimal("18400.00", "18400.01")).toBe(false);
    expect(sameDecimal("n/a", "n/a")).toBe(false);
    expect(isZero("0.00")).toBe(true);
    expect(isZero("0")).toBe(true);
    expect(isZero("0.01")).toBe(false);
    expect(isZero("")).toBe(false);
  });
});

describe("ticking rows of a list", () => {
  const page = ["a", "b", "c"];

  it("ticks a row that was not ticked, and unticks one that was", () => {
    const one = toggleOne(new Set(), "a");
    expect([...one]).toEqual(["a"]);
    expect([...toggleOne(one, "b")]).toEqual(["a", "b"]);
    expect([...toggleOne(one, "a")]).toEqual([]);
    expect([...one]).toEqual(["a"]); // the set it was given is left as it was
  });

  it("knows whether none, some or all of the rows on a page are ticked", () => {
    expect(selectionState(new Set(), page)).toBe("none");
    expect(selectionState(new Set(["b"]), page)).toBe("some");
    expect(selectionState(new Set(["a", "b", "c"]), page)).toBe("all");
    // Something ticked elsewhere does not make this page ticked.
    expect(selectionState(new Set(["z"]), page)).toBe("none");
    // With nothing that can be ticked, nothing is.
    expect(selectionState(new Set(["a"]), [])).toBe("none");
  });

  it("ticks every row at once, and unticks them all when they already were", () => {
    expect([...toggleAll(new Set(), page)]).toEqual(page);
    expect([...toggleAll(new Set(["b"]), page)].sort()).toEqual(page); // some becomes all
    expect([...toggleAll(new Set(page), page)]).toEqual([]);
    // What was ticked outside these rows stays ticked either way.
    expect([...toggleAll(new Set(["z", ...page]), page)]).toEqual(["z"]);
  });

  it("drops what is no longer on the page, so that nothing is acted on unseen", () => {
    // "b" was approved by someone else and left the queue; "z" is on another page.
    expect(keepSelected(new Set(["a", "b", "z"]), ["a", "c"])).toEqual(["a"]);
    expect(keepSelected(new Set(["a"]), [])).toEqual([]);
    expect(keepSelected(new Set(), page)).toEqual([]);
  });
});

describe("API problems", () => {
  const problem = {
    type: "about:blank",
    title: "Validation failed",
    status: 422,
    code: "validation_error",
    detail: "One or more fields are invalid.",
    errors: [
      { field: "email", message: "Already a member." },
      { field: "password", message: "Use at least 10 characters." },
    ],
  };

  it("recognizes a problem document", () => {
    expect(isProblem(problem)).toBe(true);
    expect(isProblem(new TypeError("fetch failed"))).toBe(false);
    expect(isProblem(null)).toBe(false);
    expect(isProblem("Internal Server Error")).toBe(false);
  });

  it("chooses a message for the user", () => {
    expect(problemMessage(problem)).toBe("One or more fields are invalid.");
    expect(problemMessage({ ...problem, detail: undefined })).toBe("Validation failed");
    expect(problemMessage(new TypeError("fetch failed"))).toBe("Something went wrong. Try again.");
    expect(problemMessage(undefined, "Could not save.")).toBe("Could not save.");
  });

  it("maps field errors by field name", () => {
    expect(fieldErrors(problem)).toEqual({
      email: "Already a member.",
      password: "Use at least 10 characters.",
    });
    expect(fieldErrors(new Error("nope"))).toEqual({});
  });

  it("puts messages on the fields a form has, and returns the rest for the form", () => {
    const setError = vi.fn();

    expect(applyProblem(problem, setError, ["email", "full_name"])).toBeNull();
    expect(setError).toHaveBeenCalledExactlyOnceWith(
      "email",
      { type: "server", message: "Already a member." },
      { shouldFocus: true },
    );

    setError.mockClear();
    expect(applyProblem(problem, setError, ["full_name"])).toBe("One or more fields are invalid.");
    expect(setError).not.toHaveBeenCalled();
  });

  it("moves focus to the first field with a message, which may be scrolled out of sight", () => {
    const setError = vi.fn();

    // In the order the form lists its fields, not the order the API reported them.
    applyProblem(problem, setError, ["full_name", "password", "email"]);

    expect(setError.mock.calls).toEqual([
      [
        "password",
        { type: "server", message: "Use at least 10 characters." },
        { shouldFocus: true },
      ],
      ["email", { type: "server", message: "Already a member." }, { shouldFocus: false }],
    ]);
  });

  it("only accepts filter values it knows", () => {
    expect(pick("active", ["active", "suspended"] as const)).toBe("active");
    expect(pick("deleted", ["active", "suspended"] as const)).toBeUndefined();
    expect(pick(undefined, ["active"] as const)).toBeUndefined();
  });

  it("only passes on a record filter that has the shape of an id", () => {
    const id = "01a21584-7366-77da-a39e-3f26ff6cfc39";

    expect(pickId(id)).toBe(id);
    expect(pickId(id.toUpperCase())).toBe(id.toUpperCase());
    expect(pickId("calloway")).toBeUndefined();
    expect(pickId(`${id}' OR 1=1`)).toBeUndefined();
    expect(pickId(undefined)).toBeUndefined();
  });

  it("only passes on a date filter that is a real calendar date", () => {
    expect(pickDate("2026-11-26")).toBe("2026-11-26");
    expect(pickDate("2026-02-30")).toBeUndefined();
    expect(pickDate("last week")).toBeUndefined();
    expect(pickDate(undefined)).toBeUndefined();
  });
});

describe("select options", () => {
  it("lists a label map in the order it was written", () => {
    expect(optionsFrom({ prospect: "Prospect", active: "Active", inactive: "Inactive" })).toEqual([
      { value: "prospect", label: "Prospect" },
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" },
    ]);
  });

  it("offers records by name, and keeps the saved one even when the list has lost it", () => {
    const calloway = { id: "c1", name: "Calloway Property Group" };
    const larkspur = { id: "c2", name: "Larkspur Medical Partners" };
    const archived = { id: "c9", name: "Wexcombe Hospitality Group" };

    expect(recordOptions([calloway, larkspur])).toEqual([
      { value: "c1", label: "Calloway Property Group" },
      { value: "c2", label: "Larkspur Medical Partners" },
    ]);
    expect(recordOptions([calloway, larkspur], larkspur)).toHaveLength(2);
    expect(recordOptions([calloway, larkspur], archived)[0]).toEqual({
      value: "c9",
      label: "Wexcombe Hospitality Group",
    });
    expect(recordOptions([], null)).toEqual([]);
  });

  it("offers people by their full name, and keeps the saved one too", () => {
    const priya = { id: "e1", full_name: "Priya Raman" };
    const gone = { id: "e9", full_name: "Victor Osei" };

    expect(personOptions([priya])).toEqual([{ value: "e1", label: "Priya Raman" }]);
    expect(personOptions([priya], gone)).toEqual([
      { value: "e9", label: "Victor Osei" },
      { value: "e1", label: "Priya Raman" },
    ]);
  });

  it("offers contracts by number and name, and says when one is not in force", () => {
    const janitorial = {
      id: "k1",
      contract_number: "CTR-0001",
      name: "Janitorial Services Agreement",
      status: "active",
    };
    const windows = {
      id: "k2",
      contract_number: "CTR-0012",
      name: "Window Cleaning Program",
      status: "expired",
    };
    const saved = { id: "k9", contract_number: "CTR-0004", name: "Day Porter Program" };

    expect(contractOptions([janitorial, windows])).toEqual([
      { value: "k1", label: "CTR-0001 · Janitorial Services Agreement" },
      { value: "k2", label: "CTR-0012 · Window Cleaning Program (expired)" },
    ]);
    // The contract a record already has stays on offer, whatever the list holds now.
    expect(contractOptions([janitorial], saved)[0]).toEqual({
      value: "k9",
      label: "CTR-0004 · Day Porter Program",
    });
    expect(contractOptions([janitorial], janitorial)).toHaveLength(1);
  });

  it("lists contracts under their customers in a filter, where several share a name", () => {
    const contract = (id: string, name: string, customer: string) => ({
      id,
      contract_number: `CTR-${id}`,
      name,
      customer: { name: customer },
    });

    expect(
      contractFilterOptions([
        contract("3", "Janitorial Services Agreement", "Penhallow Square Associates"),
        contract("2", "Day Porter Program", "Calloway Property Group"),
        contract("1", "Janitorial Services Agreement", "Calloway Property Group"),
      ]),
    ).toEqual([
      { value: "2", label: "Calloway Property Group · Day Porter Program" },
      { value: "1", label: "Calloway Property Group · Janitorial Services Agreement" },
      { value: "3", label: "Penhallow Square Associates · Janitorial Services Agreement" },
    ]);
  });
});

describe("form fields", () => {
  const messages = (result: { error?: { issues: { message: string }[] } }) =>
    result.error?.issues.map((issue) => issue.message) ?? [];

  it("accepts an email address or nothing at all", () => {
    expect(optionalEmail.parse("")).toBe("");
    expect(optionalEmail.parse(" renee.aldous@harborline.example ")).toBe(
      "renee.aldous@harborline.example",
    );
    expect(messages(optionalEmail.safeParse("renee@"))).toEqual(["Enter a valid email address."]);
  });

  it("checks that a number looks like one, and leaves its range to the API", () => {
    expect(optionalWholeNumber.parse("")).toBe("");
    expect(optionalWholeNumber.parse(" 240000 ")).toBe("240000");
    expect(messages(optionalWholeNumber.safeParse("240,000"))).toEqual(["Enter a whole number."]);
    expect(messages(optionalWholeNumber.safeParse("18.5"))).toEqual(["Enter a whole number."]);
    expect(optionalWholeNumber.safeParse("999").success).toBe(true); // 999 floors is the API's call

    const days = wholeNumber("Enter the number of days.");
    expect(days.parse("45")).toBe("45");
    expect(messages(days.safeParse(""))).toEqual(["Enter the number of days."]);
    expect(messages(days.safeParse("net 30"))).toEqual(["Enter a whole number."]);
  });

  it("keeps amounts as the text that was typed", () => {
    expect(optionalAmount.parse("18400.00")).toBe("18400.00");
    expect(optionalAmount.parse("19.5")).toBe("19.5");
    expect(optionalAmount.parse("")).toBe("");
    for (const wrong of ["19.505", "$19.50", "1,250.00", "-5", "abc", "."]) {
      expect(messages(optionalAmount.safeParse(wrong))).toEqual(["Enter an amount such as 18.50."]);
    }

    expect(optionalPercent.parse("12.5")).toBe("12.5");
    expect(optionalPercent.parse("")).toBe("");
    for (const wrong of ["12.555", "12%", "1250"]) {
      expect(messages(optionalPercent.safeParse(wrong))).toEqual([
        "Enter a percentage such as 12.5.",
      ]);
    }
  });

  it("asks for an amount where there has to be one, and takes it as it was typed", () => {
    const amount = requiredAmount("Enter the amount.");

    expect(amount.parse(" 184.20 ")).toBe("184.20");
    expect(amount.parse("2500")).toBe("2500");
    expect(messages(amount.safeParse(""))).toEqual(["Enter the amount."]);
    expect(messages(amount.safeParse("184.205"))).toEqual(["Enter an amount such as 18.50."]);
    expect(messages(amount.safeParse("$184.20"))).toEqual(["Enter an amount such as 18.50."]);
    // Whether zero is an acceptable amount is the API's to say.
    expect(amount.safeParse("0").success).toBe(true);
  });

  it("checks that hours look like hours, and leaves how many there can be to the API", () => {
    const hours = requiredHours("Enter the regular hours worked.");

    expect(hours.parse("8")).toBe("8");
    expect(hours.parse(" 7.5 ")).toBe("7.5");
    expect(hours.parse("7.25")).toBe("7.25");
    expect(messages(hours.safeParse(""))).toEqual(["Enter the regular hours worked."]);
    for (const wrong of ["7.255", "eight", "7h", "-1", "100"]) {
      expect(messages(hours.safeParse(wrong))).toEqual(["Enter hours such as 7.5."]);
    }
    expect(hours.safeParse("30").success).toBe(true); // more than a day holds: the API says so

    expect(optionalHours.parse("")).toBe("");
    expect(optionalHours.parse("1.5")).toBe("1.5");
    expect(messages(optionalHours.safeParse("1:30"))).toEqual(["Enter hours such as 7.5."]);
  });

  it("takes a time of day as a time input gives it", () => {
    const time = timeOfDay("Enter the time the shift starts.");

    expect(time.parse("00:00")).toBe("00:00");
    expect(time.parse("17:30")).toBe("17:30");
    expect(time.parse("23:59")).toBe("23:59");
    for (const wrong of ["", "24:00", "9:00", "17:60", "5:00 PM"]) {
      expect(messages(time.safeParse(wrong))).toEqual(["Enter the time the shift starts."]);
    }
  });

  it("asks for a two-letter country code", () => {
    expect(countryCode.parse("us")).toBe("us");
    for (const wrong of ["", "USA", "U1"]) {
      expect(messages(countryCode.safeParse(wrong))).toEqual([
        "Use a two-letter country code such as US.",
      ]);
    }
  });

  it("sends nothing, rather than an empty string, for a field left blank", () => {
    expect(blankToNull("")).toBeNull();
    expect(blankToNull("Suite 400")).toBe("Suite 400");
    expect(toInteger("")).toBeNull();
    expect(toInteger("240000")).toBe(240000);
  });

  it("fills an address in from a record and turns it back into one", () => {
    const stored = {
      address_line1: "410 Hollis Street",
      address_line2: null,
      city: "New York",
      region: "NY",
      postal_code: "10016",
      country: "US",
    };

    expect(addressDefaults(stored)).toEqual({ ...stored, address_line2: "" });
    expect(addressDefaults(null)).toEqual({
      address_line1: "",
      address_line2: "",
      city: "",
      region: "",
      postal_code: "",
      country: "US",
    });
    expect(addressBody({ ...addressDefaults(stored), country: "ca" })).toEqual({
      ...stored,
      country: "CA",
    });
    expect(contactBody({ contact_name: "Renee Aldous", email: "", phone: "" })).toEqual({
      contact_name: "Renee Aldous",
      email: null,
      phone: null,
    });
  });
});

describe("navigation", () => {
  const labels = (permissions: Parameters<typeof visibleNavigation>[0]) =>
    visibleNavigation(permissions).flatMap((section) => section.items.map((item) => item.label));

  it("shows each person only what their permissions allow", () => {
    expect(labels(["organization:read"])).toEqual(["Overview", "Organization"]);
    expect(labels(["organization:read", "members:read", "audit:read"])).toEqual([
      "Overview",
      "Members",
      "Organization",
      "Audit log",
    ]);
    expect(labels(["platform:organizations"])).toEqual(["Overview", "Organizations"]);
    expect(labels([])).toEqual(["Overview"]);
  });

  it("lists the master data a person may read, operations before workforce", () => {
    // A supervisor: the directory, but not contracts.
    expect(labels(["customers:read", "buildings:read", "vendors:read", "employees:read"])).toEqual([
      "Overview",
      "Buildings",
      "Customers",
      "Vendors",
      "Employees",
      "Job roles",
    ]);
    expect(labels(["contracts:read"])).toEqual(["Overview", "Contracts"]);
    // Writing something is not what puts it in the menu.
    expect(labels(["customers:write", "employees:read_compensation"])).toEqual(["Overview"]);
  });

  it("lists the day-to-day records a person may read, each where its section is", () => {
    // A supervisor: work orders, the schedule, time and expenses, but not invoices.
    expect(
      labels([
        "buildings:read",
        "employees:read",
        "work_orders:read",
        "schedule:read",
        "timesheets:read",
        "expenses:read",
      ]),
    ).toEqual([
      "Overview",
      "Work orders",
      "Buildings",
      "Employees",
      "Schedule",
      "Timesheets",
      "Job roles",
      "Expenses",
    ]);
    expect(labels(["invoices:read"])).toEqual(["Overview", "Invoices"]);
    // Being able to write, or to approve, is not what puts something in the menu.
    expect(labels(["work_orders:write", "timesheets:approve", "expenses:approve"])).toEqual([
      "Overview",
    ]);
  });

  it("puts finance after workforce and before administration", () => {
    const sections = visibleNavigation([
      "work_orders:read",
      "timesheets:read",
      "invoices:read",
      "members:read",
    ]);
    expect(sections.map((section) => section.label)).toEqual([
      undefined,
      "Operations",
      "Workforce",
      "Finance",
      "Administration",
    ]);
  });

  it("drops a section when none of its items are visible", () => {
    const sections = visibleNavigation(["organization:read"]).map((section) => section.label);
    expect(sections).toEqual([undefined, "Administration"]);

    const directory = visibleNavigation(["buildings:read", "employees:read", "audit:read"]);
    expect(directory.map((section) => section.label)).toEqual([
      undefined,
      "Operations",
      "Workforce",
      "Administration",
    ]);
  });

  it("marks the right item active", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/settings/members", "/")).toBe(false);
    expect(isActivePath("/settings/members", "/settings/members")).toBe(true);
    expect(isActivePath("/settings/members/abc", "/settings/members")).toBe(true);
    expect(isActivePath("/settings/members-archive", "/settings/members")).toBe(false);
  });

  it("builds breadcrumbs from the navigation", () => {
    expect(breadcrumbsFor("/")).toEqual(["Overview"]);
    expect(breadcrumbsFor("/settings/audit-log")).toEqual(["Administration", "Audit log"]);
    expect(breadcrumbsFor("/buildings")).toEqual(["Operations", "Buildings"]);
    expect(breadcrumbsFor("/job-roles")).toEqual(["Workforce", "Job roles"]);
    expect(breadcrumbsFor("/work-orders")).toEqual(["Operations", "Work orders"]);
    expect(breadcrumbsFor("/schedule")).toEqual(["Workforce", "Schedule"]);
    expect(breadcrumbsFor("/timesheets")).toEqual(["Workforce", "Timesheets"]);
    expect(breadcrumbsFor("/expenses")).toEqual(["Finance", "Expenses"]);
    expect(breadcrumbsFor("/invoices")).toEqual(["Finance", "Invoices"]);
    expect(breadcrumbsFor("/settings/account")).toEqual(["Account"]);
    expect(breadcrumbsFor("/nowhere")).toEqual([]);
  });
});

describe("regional settings", () => {
  it("groups time zones by region and keeps an unknown saved value", () => {
    const groups = new Map(groupedTimeZones("Mars/Olympus_Mons"));

    expect(groups.get("America")).toContain("America/New_York");
    expect(groups.get("Mars")).toEqual(["Mars/Olympus_Mons"]);
  });

  it("labels a zone by its city", () => {
    expect(timeZoneLabel("America/New_York")).toBe("New York");
    expect(timeZoneLabel("America/Argentina/Buenos_Aires")).toBe("Argentina / Buenos Aires");
    expect(timeZoneLabel("UTC")).toBe("UTC");
  });
});

describe("member forms", () => {
  it("generates a readable password that meets the policy, different every time", () => {
    const passwords = new Set(Array.from({ length: 50 }, () => generatePassword()));

    expect(passwords.size).toBe(50);
    for (const password of passwords) {
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/);
      expect(password.length).toBeGreaterThanOrEqual(10);
    }
  });

  it("validates a new member before anything is sent", () => {
    const result = addMemberSchema.safeParse({
      email: "not-an-email",
      full_name: "   ",
      role: "platform_admin",
      title: "",
      password: "",
    });

    expect(result.success).toBe(false);
    const fields = result.error!.issues.map((issue) => issue.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["email", "full_name", "role"]));
  });

  it("accepts a valid new member and trims what was typed", () => {
    const result = addMemberSchema.parse({
      email: "tessa@example.com",
      full_name: "  Tessa Nguyen ",
      role: "supervisor",
      title: " Evening Supervisor ",
      password: "",
    });

    expect(result.full_name).toBe("Tessa Nguyen");
    expect(result.title).toBe("Evening Supervisor");
  });

  it("only allows roles and access states that exist", () => {
    expect(editMemberSchema.safeParse({ role: "owner", status: "active", title: "" }).success).toBe(
      false,
    );
    expect(
      editMemberSchema.safeParse({ role: "employee", status: "deleted", title: "" }).success,
    ).toBe(false);
    expect(
      editMemberSchema.safeParse({ role: "employee", status: "suspended", title: "" }).success,
    ).toBe(true);
  });
});
