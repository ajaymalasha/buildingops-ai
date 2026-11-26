import { describe, expect, it } from "vitest";

import type { Expense } from "@/lib/api/types";

import { bookedTo, expenseBody, expenseDefaults, expenseSchema } from "./expense-form-schema";

const EVERYTHING = { contract: true, vendor: true, workOrder: true };

const saved: Expense = {
  id: "expense-1",
  category: "subcontractor",
  description: "Service call and repair",
  amount: "1840.50",
  currency: "USD",
  incurred_on: "2026-11-20",
  building: { id: "building-1", name: "Calloway Tower" },
  contract: {
    id: "contract-1",
    contract_number: "CTR-0001",
    name: "Janitorial Services Agreement",
  },
  vendor: { id: "vendor-1", name: "Dovemoor Mechanical Services" },
  work_order: { id: "wo-1", number: "WO-0412", title: "No cooling on the 4th floor" },
  billable: false,
  reference: "DM-48213",
  status: "pending",
  decided_by_name: null,
  decided_at: null,
  rejection_reason: null,
  created_at: "2026-11-21T14:00:00Z",
  updated_at: "2026-11-21T14:00:00Z",
};

describe("the expense form", () => {
  it("opens a new expense as billable supplies, for today where the organization is", () => {
    expect(expenseDefaults(null, { today: "2026-11-26" })).toEqual({
      description: "",
      category: "supplies",
      amount: "",
      incurred_on: "2026-11-26",
      reference: "",
      building_id: "",
      contract_id: "",
      vendor_id: "",
      work_order_id: "",
      billable: true,
    });
  });

  it("opens a pending expense with what is on record", () => {
    expect(expenseDefaults(saved, { today: "2026-11-26" })).toEqual({
      description: "Service call and repair",
      category: "subcontractor",
      amount: "1840.50",
      incurred_on: "2026-11-20",
      reference: "DM-48213",
      building_id: "building-1",
      contract_id: "contract-1",
      vendor_id: "vendor-1",
      work_order_id: "wo-1",
      billable: false,
    });
  });

  it("asks what it was and how much, and for an amount that looks like money", () => {
    const blank = expenseSchema.safeParse(expenseDefaults(null, { today: "2026-11-26" }));
    expect(blank.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ["description", "Enter what was bought or paid for."],
      ["amount", "Enter the amount."],
    ]);

    const typed = expenseSchema.safeParse({
      ...expenseDefaults(null, { today: "2026-11-26" }),
      description: "Ice melt",
      amount: "$184.20",
      incurred_on: "",
    });
    expect(typed.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ["amount", "Enter an amount such as 18.50."],
      ["incurred_on", "Choose the day the expense was incurred."],
    ]);
  });

  it("sends the amount as the text that was typed, and blanks as nothing", () => {
    const values = expenseSchema.parse({
      ...expenseDefaults(null, { today: "2026-11-26" }),
      description: "  Floor finish and stripper ",
      amount: " 184.2 ",
    });

    expect(expenseBody(values, { offered: EVERYTHING })).toEqual({
      description: "Floor finish and stripper",
      category: "supplies",
      amount: "184.2", // a string, never a number
      incurred_on: "2026-11-26",
      reference: null,
      building_id: null,
      contract_id: null,
      vendor_id: null,
      work_order_id: null,
      billable: true,
    });
  });

  it("never sends the currency or the status: they are the API's", () => {
    const body = expenseBody(expenseDefaults(saved, { today: "2026-11-26" }), {
      offered: EVERYTHING,
    });

    expect(body).not.toHaveProperty("currency");
    expect(body).not.toHaveProperty("status");
    expect(body).toMatchObject({ contract_id: "contract-1", work_order_id: "wo-1" });
  });

  it("does not mention what the form did not offer", () => {
    // A supervisor reads no contracts. A null here would take the expense off its contract.
    const body = expenseBody(expenseDefaults(saved, { today: "2026-11-26" }), {
      offered: { contract: false, vendor: true, workOrder: false },
    });

    expect(body).not.toHaveProperty("contract_id");
    expect(body).not.toHaveProperty("work_order_id");
    expect(body.vendor_id).toBe("vendor-1");
  });
});

describe("what an expense is booked to, in the list", () => {
  it("names its work order and its contract by the numbers people quote", () => {
    expect(bookedTo(saved)).toBe("WO-0412 · CTR-0001");
    expect(bookedTo({ ...saved, work_order: null })).toBe("CTR-0001");
    expect(bookedTo({ ...saved, contract: null })).toBe("WO-0412");
  });

  it("says nothing when it is booked to neither", () => {
    expect(bookedTo({ work_order: null, contract: null })).toBeNull();
  });
});
