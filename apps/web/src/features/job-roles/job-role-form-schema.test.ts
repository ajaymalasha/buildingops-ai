import { describe, expect, it } from "vitest";

import type { JobRole } from "@/lib/api/types";

import { jobRoleBody, jobRoleDefaults, jobRoleSchema } from "./job-role-form-schema";

const custodian: JobRole = {
  id: "role-1",
  name: "Custodian",
  description: "Evening and overnight cleaning.",
  default_hourly_rate: "19.50",
  is_supervisory: false,
  employee_count: 34,
  created_at: "2026-11-26T14:00:00Z",
  updated_at: "2026-11-26T14:00:00Z",
};

describe("the job role form", () => {
  it("opens blank for a new role and filled in for an existing one", () => {
    expect(jobRoleDefaults(null)).toEqual({
      name: "",
      description: "",
      default_hourly_rate: "",
      is_supervisory: false,
    });
    expect(jobRoleDefaults(custodian)).toEqual({
      name: "Custodian",
      description: "Evening and overnight cleaning.",
      default_hourly_rate: "19.50",
      is_supervisory: false,
    });
  });

  it("opens with no rate for someone the API does not show pay to", () => {
    expect(jobRoleDefaults({ ...custodian, default_hourly_rate: null }).default_hourly_rate).toBe(
      "",
    );
  });

  it("sends the rate as text, or nothing when it was left blank", () => {
    const values = jobRoleSchema.parse({ ...jobRoleDefaults(custodian), name: " Night Porter " });

    expect(jobRoleBody(values, { includeRate: true })).toEqual({
      name: "Night Porter",
      description: "Evening and overnight cleaning.",
      is_supervisory: false,
      default_hourly_rate: "19.50",
    });
    expect(
      jobRoleBody({ ...values, default_hourly_rate: "", description: "" }, { includeRate: true }),
    ).toMatchObject({ default_hourly_rate: null, description: null });
  });

  it("does not mention the rate at all for someone who may not see pay", () => {
    const values = jobRoleSchema.parse(
      jobRoleDefaults({ ...custodian, default_hourly_rate: null }),
    );

    // A null here would erase the rate that person cannot see.
    expect(jobRoleBody(values, { includeRate: false })).toEqual({
      name: "Custodian",
      description: "Evening and overnight cleaning.",
      is_supervisory: false,
    });
  });

  it("asks for a name, and for a rate that looks like money", () => {
    const result = jobRoleSchema.safeParse({
      ...jobRoleDefaults(null),
      name: "   ",
      default_hourly_rate: "twenty",
    });

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Enter the role's name.",
      "Enter an amount such as 18.50.",
    ]);
  });
});
