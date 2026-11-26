import { describe, expect, it, vi } from "vitest";

import { formatValue } from "@/features/audit/audit-log-page";
import { safeRedirectPath } from "@/features/auth/sign-in";
import {
  addMemberSchema,
  editMemberSchema,
  generatePassword,
} from "@/features/members/member-form-schema";
import { fieldErrors, isProblem, problemMessage } from "@/lib/api/problem";
import { daysBetween, nextDay, startOfDayInZone, todayInZone } from "@/lib/dates";
import {
  addressBody,
  addressDefaults,
  blankToNull,
  contactBody,
  countryCode,
  optionalAmount,
  optionalEmail,
  optionalPercent,
  optionalWholeNumber,
  toInteger,
  wholeNumber,
} from "@/lib/form-fields";
import { applyProblem, optionsFrom, pick, pickId, recordOptions } from "@/lib/forms";
import {
  formatDate,
  formatDateTime,
  formatDay,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
  humanize,
  initials,
} from "@/lib/format";
import { breadcrumbsFor, isActivePath, visibleNavigation } from "@/lib/navigation";
import { groupedTimeZones, timeZoneLabel } from "@/lib/regional";

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
