import { describe, expect, it } from "vitest";

import type { WorkOrder } from "@/lib/api/types";

import {
  assigneeGroups,
  workOrderBody,
  workOrderDefaults,
  workOrderSchema,
} from "./work-order-form-schema";

const NEW_YORK = "America/New_York";
const EVERYTHING = { contract: true, assignee: true, vendor: true };

const saved: WorkOrder = {
  id: "wo-1",
  number: "WO-0412",
  title: "No cooling on the 4th floor",
  description: "Second report this month.",
  category: "hvac",
  priority: "urgent",
  status: "scheduled",
  source: "customer_request",
  building: { id: "building-1", name: "Calloway Tower" },
  contract: {
    id: "contract-1",
    contract_number: "CTR-0001",
    name: "Janitorial Services Agreement",
  },
  assigned_employee: { id: "employee-1", full_name: "Luis Ortega", employee_number: "EMP-0076" },
  vendor: { id: "vendor-1", name: "Dovemoor Mechanical Services" },
  requested_by: "Renee Aldous",
  due_on: "2026-11-28",
  // Booked for 9:30 AM in New York, recorded with the seconds a status change left on it.
  scheduled_for: "2026-11-27T14:30:41.512Z",
  started_at: null,
  completed_at: null,
  billable: false,
  is_overdue: false,
  created_at: "2026-11-24T13:05:00Z",
  updated_at: "2026-11-24T13:05:00Z",
};

describe("the work order form", () => {
  it("opens a new work order as internal, normal priority and billable, with the rest blank", () => {
    expect(workOrderDefaults(null, { timeZone: NEW_YORK })).toEqual({
      title: "",
      description: "",
      building_id: "",
      contract_id: "",
      category: "cleaning",
      priority: "normal",
      source: "internal",
      assigned_employee_id: "",
      vendor_id: "",
      requested_by: "",
      due_on: "",
      scheduled_for: "",
      billable: true,
    });
  });

  it("starts a new work order at the building the list is filtered to", () => {
    expect(
      workOrderDefaults(null, { timeZone: NEW_YORK, buildingId: "building-7" }).building_id,
    ).toBe("building-7");
    // An existing work order keeps its own building, whatever the list shows.
    expect(
      workOrderDefaults(saved, { timeZone: NEW_YORK, buildingId: "building-7" }).building_id,
    ).toBe("building-1");
  });

  it("opens a saved work order with what is on record, the time on the organization's clocks", () => {
    expect(workOrderDefaults(saved, { timeZone: NEW_YORK })).toMatchObject({
      title: "No cooling on the 4th floor",
      building_id: "building-1",
      contract_id: "contract-1",
      category: "hvac",
      priority: "urgent",
      source: "customer_request",
      assigned_employee_id: "employee-1",
      vendor_id: "vendor-1",
      requested_by: "Renee Aldous",
      due_on: "2026-11-28",
      scheduled_for: "2026-11-27T09:30",
      billable: false,
    });
    expect(workOrderDefaults(saved, { timeZone: "America/Chicago" }).scheduled_for).toBe(
      "2026-11-27T08:30",
    );
  });

  it("asks for a title and a building, and nothing else", () => {
    const result = workOrderSchema.safeParse(workOrderDefaults(null, { timeZone: NEW_YORK }));

    expect(result.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ["title", "Enter what needs doing."],
      ["building_id", "Choose the building the work is at."],
    ]);
  });

  it("sends a new work order with blanks as nothing and its time as an instant", () => {
    const values = workOrderSchema.parse({
      ...workOrderDefaults(null, { timeZone: NEW_YORK }),
      title: "  Replace the lamps in the east stairwell ",
      building_id: "building-1",
      category: "maintenance",
      due_on: "2026-12-02",
      scheduled_for: "2026-12-01T07:30",
    });

    expect(
      workOrderBody(values, { timeZone: NEW_YORK, offered: EVERYTHING, opened: null }),
    ).toEqual({
      title: "Replace the lamps in the east stairwell",
      description: null,
      building_id: "building-1",
      contract_id: null,
      category: "maintenance",
      priority: "normal",
      source: "internal",
      assigned_employee_id: null,
      vendor_id: null,
      requested_by: null,
      due_on: "2026-12-02",
      // 7:30 AM in New York, with its offset: the API takes instants.
      scheduled_for: "2026-12-01T12:30:00.000Z",
      billable: true,
    });
  });

  it("never sends the status: a work order moves through its own endpoint", () => {
    const values = workOrderDefaults(saved, { timeZone: NEW_YORK });

    expect(
      workOrderBody(values, { timeZone: NEW_YORK, offered: EVERYTHING, opened: values }),
    ).not.toHaveProperty("status");
  });

  it("leaves the scheduled time alone when nobody changed it, seconds and all", () => {
    const opened = workOrderDefaults(saved, { timeZone: NEW_YORK });
    const options = { timeZone: NEW_YORK, offered: EVERYTHING, opened };

    // Only the title was changed: the time on record keeps the seconds the form cannot show.
    expect(
      workOrderBody({ ...opened, title: "No cooling on floor 4" }, options),
    ).not.toHaveProperty("scheduled_for");
    expect(
      workOrderBody({ ...opened, scheduled_for: "2026-11-30T13:00" }, options).scheduled_for,
    ).toBe("2026-11-30T18:00:00.000Z");
    // Emptied on purpose: the booking is taken off.
    expect(workOrderBody({ ...opened, scheduled_for: "" }, options).scheduled_for).toBeNull();
  });

  it("does not mention what the form did not offer", () => {
    const values = workOrderDefaults(saved, { timeZone: NEW_YORK });
    // A supervisor reads no contracts. A null here would take the work order off its contract.
    const body = workOrderBody(values, {
      timeZone: NEW_YORK,
      offered: { contract: false, assignee: true, vendor: false },
      opened: values,
    });

    expect(body).not.toHaveProperty("contract_id");
    expect(body).not.toHaveProperty("vendor_id");
    expect(body.assigned_employee_id).toBe("employee-1");
  });
});

describe("who a work order can be given to", () => {
  const person = (id: string, name: string, status: "active" | "terminated" = "active") => ({
    id,
    full_name: name,
    status,
  });
  const ana = person("1", "Ana Zamora");
  const bo = person("2", "Bo Adams");
  const cy = person("3", "Cy Brandt");
  const gone = person("4", "Victor Osei", "terminated");

  it("offers the people at the building first, then everyone else", () => {
    expect(assigneeGroups([bo], [bo, cy, ana], null, "Calloway Tower")).toEqual([
      { label: "Assigned to Calloway Tower", people: [{ id: "2", name: "Bo Adams" }] },
      {
        label: "Everyone else",
        people: [
          { id: "3", name: "Cy Brandt" },
          { id: "1", name: "Ana Zamora" },
        ],
      },
    ]);
  });

  it("is one plain list before a building is chosen, or when nobody is assigned to it", () => {
    expect(assigneeGroups([], [bo, cy], null)).toEqual([
      {
        label: "Employees",
        people: [
          { id: "2", name: "Bo Adams" },
          { id: "3", name: "Cy Brandt" },
        ],
      },
    ]);
  });

  it("does not offer people who have left", () => {
    const names = assigneeGroups([gone, bo], [bo, gone, cy], null).flatMap((group) =>
      group.people.map((member) => member.name),
    );
    expect(names).toEqual(["Bo Adams", "Cy Brandt"]);
  });

  it("keeps the person already assigned, even one who has left or been archived", () => {
    // Left the company, but still on record as having this work order.
    expect(assigneeGroups([], [bo, gone], { id: "4", full_name: "Victor Osei" })).toEqual([
      {
        label: "Employees",
        people: [
          { id: "2", name: "Bo Adams" },
          { id: "4", name: "Victor Osei" },
        ],
      },
    ]);
    // Archived since, so not among the employees at all.
    expect(assigneeGroups([], [bo], { id: "77", full_name: "Elena Aguilar" })[0]).toEqual({
      label: "Assigned now",
      people: [{ id: "77", name: "Elena Aguilar" }],
    });
  });

  it("lists nobody twice", () => {
    const ids = assigneeGroups([bo, ana], [ana, bo, cy], {
      id: "2",
      full_name: "Bo Adams",
    }).flatMap((group) => group.people.map((member) => member.id));
    expect(ids).toEqual(["2", "1", "3"]);
  });

  it("has nobody to offer in an organization with no employees", () => {
    expect(assigneeGroups([], [], null)).toEqual([]);
  });
});
