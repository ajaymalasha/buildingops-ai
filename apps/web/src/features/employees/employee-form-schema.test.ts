import { describe, expect, it } from "vitest";

import type { Assignment, Employee } from "@/lib/api/types";

import {
  assignSchema,
  employeeBody,
  employeeDefaults,
  employeeSchema,
  endAssignmentSchema,
  splitAssignments,
  supervisorGroups,
} from "./employee-form-schema";

const SITE_SUPERVISOR = { id: "role-site", name: "Site Supervisor" };
const AREA_SUPERVISOR = { id: "role-area", name: "Area Supervisor" };
const CUSTODIAN = { id: "role-custodian", name: "Custodian" };

function employee(id: string, fullName: string, changes: Partial<Employee> = {}): Employee {
  const [firstName = "", lastName = ""] = fullName.split(" ");
  return {
    id,
    employee_number: `EMP-${id}`,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    email: null,
    phone: null,
    employment_type: "full_time",
    status: "active",
    hire_date: "2024-03-04",
    termination_date: null,
    hourly_rate: "19.50",
    notes: null,
    job_role: CUSTODIAN,
    supervisor: null,
    primary_building: null,
    membership_id: null,
    created_at: "2024-03-04T14:00:00Z",
    updated_at: "2024-03-04T14:00:00Z",
    ...changes,
  };
}

const priya = employee("1", "Priya Raman", { job_role: SITE_SUPERVISOR });
const ngozi = employee("2", "Ngozi Baptiste", { job_role: SITE_SUPERVISOR });
const anjali = employee("3", "Anjali Ali", { job_role: AREA_SUPERVISOR });
const gone = employee("4", "Victor Osei", { job_role: SITE_SUPERVISOR, status: "terminated" });
const supervisors = [anjali, ngozi, gone, priya];

describe("who can be chosen as a supervisor", () => {
  it("offers the people in supervisory roles, grouped by role", () => {
    expect(supervisorGroups(supervisors, null)).toEqual([
      { label: "Area Supervisor", people: [{ id: "3", name: "Anjali Ali" }] },
      {
        label: "Site Supervisor",
        people: [
          { id: "2", name: "Ngozi Baptiste" },
          { id: "1", name: "Priya Raman" },
        ],
      },
    ]);
  });

  it("does not offer people who have left", () => {
    const names = supervisorGroups(supervisors, null).flatMap((group) =>
      group.people.map((person) => person.name),
    );
    expect(names).not.toContain("Victor Osei");
  });

  it("does not offer someone as their own supervisor", () => {
    const groups = supervisorGroups(supervisors, priya);
    expect(groups.flatMap((group) => group.people.map((person) => person.id))).toEqual(["3", "2"]);
  });

  it("keeps the supervisor already saved, even one who has left or changed role", () => {
    // Left the company, but still on record as this person's supervisor.
    const reportsToGone = employee("9", "Maya Castellano", {
      supervisor: { id: "4", full_name: "Victor Osei" },
    });
    expect(supervisorGroups(supervisors, reportsToGone)[1]?.people).toContainEqual({
      id: "4",
      name: "Victor Osei",
    });

    // No longer in a supervisory role, so not among the candidates at all.
    const reportsToCustodian = employee("9", "Maya Castellano", {
      supervisor: { id: "77", full_name: "Elena Aguilar" },
    });
    expect(supervisorGroups(supervisors, reportsToCustodian)[0]).toEqual({
      label: "Current supervisor",
      people: [{ id: "77", name: "Elena Aguilar" }],
    });
  });

  it("has nothing to offer in an organization with no supervisory roles", () => {
    expect(supervisorGroups([], null)).toEqual([]);
  });
});

describe("the employee form", () => {
  const typed = employeeSchema.parse({
    ...employeeDefaults(null),
    first_name: " Maya ",
    last_name: "Castellano",
    job_role_id: "role-custodian",
    hourly_rate: "19.50",
  });

  it("opens a new employee as active and full time, with everything else blank", () => {
    expect(employeeDefaults(null)).toMatchObject({
      employee_number: "",
      job_role_id: "",
      supervisor_id: "",
      employment_type: "full_time",
      status: "active",
      hourly_rate: "",
    });
  });

  it("opens an existing employee with what is on record", () => {
    const saved = employee("9", "Maya Castellano", {
      job_role: CUSTODIAN,
      supervisor: { id: "1", full_name: "Priya Raman" },
      status: "on_leave",
      hourly_rate: "21.25",
    });

    expect(employeeDefaults(saved)).toMatchObject({
      first_name: "Maya",
      employee_number: "EMP-9",
      job_role_id: "role-custodian",
      supervisor_id: "1",
      status: "on_leave",
      hire_date: "2024-03-04",
      termination_date: "",
      hourly_rate: "21.25",
    });
  });

  it("sends the rate as text for someone who may set pay", () => {
    expect(employeeBody(typed, { includeRate: true })).toEqual({
      first_name: "Maya",
      last_name: "Castellano",
      employee_number: null,
      email: null,
      phone: null,
      job_role_id: "role-custodian",
      supervisor_id: null,
      employment_type: "full_time",
      status: "active",
      hire_date: null,
      termination_date: null,
      notes: null,
      hourly_rate: "19.50",
    });
  });

  it("does not mention the rate at all for someone who may not see pay", () => {
    // Even a null would count: it would erase a figure the person cannot see.
    expect(employeeBody(typed, { includeRate: false })).not.toHaveProperty("hourly_rate");
  });

  it("asks for a name and a job role before anything is sent", () => {
    const result = employeeSchema.safeParse({ ...employeeDefaults(null), hourly_rate: "19.505" });

    expect(result.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ["first_name", "Enter their first name."],
      ["last_name", "Enter their last name."],
      ["job_role_id", "Choose a job role."],
      ["hourly_rate", "Enter an amount such as 18.50."],
    ]);
  });
});

describe("an employee's building assignments", () => {
  const assignment = (id: string, changes: Partial<Assignment> = {}): Assignment => ({
    id,
    building: { id: `building-${id}`, name: `Building ${id}` },
    is_primary: false,
    starts_on: "2026-01-05",
    ends_on: null,
    ...changes,
  });

  it("are listed with the primary building first, and those that have ended apart", () => {
    // As the API sends them: open ones by start date, then ended ones.
    const fromApi = [
      assignment("newest"),
      assignment("primary", { is_primary: true }),
      assignment("oldest"),
      // An assignment keeps its primary mark when it ends. It is history all the same.
      assignment("ended", { is_primary: true, ends_on: "2025-06-30" }),
    ];

    const { current, past } = splitAssignments(fromApi);

    expect(current.map((item) => item.id)).toEqual(["primary", "newest", "oldest"]);
    expect(past.map((item) => item.id)).toEqual(["ended"]);
  });

  it("may be none at all", () => {
    expect(splitAssignments([])).toEqual({ current: [], past: [] });
  });
});

describe("the assignment forms", () => {
  it("need a building and a first day", () => {
    const result = assignSchema.safeParse({ building_id: "", starts_on: "", is_primary: true });

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Choose a building.",
      "Choose the first day.",
    ]);
    expect(
      assignSchema.safeParse({ building_id: "b1", starts_on: "2026-11-26", is_primary: false })
        .success,
    ).toBe(true);
  });

  it("need a last day to end an assignment", () => {
    expect(endAssignmentSchema.safeParse({ ends_on: "" }).success).toBe(false);
    expect(endAssignmentSchema.safeParse({ ends_on: "2026-11-30" }).success).toBe(true);
  });
});
