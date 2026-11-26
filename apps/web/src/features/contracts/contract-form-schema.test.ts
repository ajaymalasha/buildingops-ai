import { describe, expect, it } from "vitest";

import type { ContractDetail } from "@/lib/api/types";

import {
  billingSummary,
  billingTerms,
  contractBody,
  contractDefaults,
  contractSchema,
  coverageOptions,
  type ContractValues,
} from "./contract-form-schema";

const blank = contractDefaults(null, { currency: "USD" });

/** A form filled in far enough to be valid, with the given changes. */
function filled(changes: Partial<ContractValues> = {}): ContractValues {
  return {
    ...blank,
    customer_id: "customer-1",
    name: "Janitorial Services Agreement",
    markup_percent: "12.5",
    start_date: "2026-12-01",
    ...changes,
  };
}

function problems(values: ContractValues): Record<string, string> {
  const result = contractSchema.safeParse(values);
  return Object.fromEntries(
    (result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]),
  );
}

const saved: ContractDetail = {
  id: "contract-1",
  contract_number: "CTR-0002",
  name: "Day Porter Program",
  status: "active",
  billing_model: "fixed_fee",
  start_date: "2026-03-01",
  end_date: "2028-02-29",
  markup_percent: null,
  monthly_fee: "18400.00",
  currency: "CAD",
  payment_terms_days: 45,
  notes: null,
  customer: { id: "customer-1", name: "Calloway Property Group" },
  building_count: 2,
  buildings: [
    { id: "building-1", name: "Calloway Tower", code: "BLD-0001" },
    { id: "building-2", name: "One Granite Plaza", code: "BLD-0002" },
  ],
  created_at: "2026-03-01T14:00:00Z",
  updated_at: "2026-03-01T14:00:00Z",
};

describe("the contract form's terms", () => {
  it("opens a new contract as a cost-plus draft in the organization's currency", () => {
    expect(blank).toMatchObject({
      customer_id: "",
      status: "draft",
      billing_model: "cost_plus",
      currency: "USD",
      payment_terms_days: "30",
      building_ids: [],
    });
    expect(contractDefaults(null, { currency: "EUR", customerId: "customer-7" })).toMatchObject({
      currency: "EUR",
      customer_id: "customer-7",
    });
  });

  it("opens a saved contract with its own terms and the buildings it covers", () => {
    expect(contractDefaults(saved, { currency: "USD", customerId: "customer-7" })).toMatchObject({
      customer_id: "customer-1",
      contract_number: "CTR-0002",
      billing_model: "fixed_fee",
      markup_percent: "",
      monthly_fee: "18400.00",
      currency: "CAD", // the contract's, not the organization's
      end_date: "2028-02-29",
      building_ids: ["building-1", "building-2"],
    });
  });

  it("asks for a markup on a cost-plus contract, and only there", () => {
    expect(problems(filled({ markup_percent: "" }))).toEqual({
      markup_percent: "Enter the markup percentage.",
    });
    expect(problems(filled({ markup_percent: "12.5" }))).toEqual({});
    expect(problems(filled({ markup_percent: "0" }))).toEqual({}); // at cost is a real answer
  });

  it("asks for a monthly fee on a fixed-fee contract, and only there", () => {
    expect(problems(filled({ billing_model: "fixed_fee", markup_percent: "" }))).toEqual({
      monthly_fee: "Enter the monthly fee.",
    });
    expect(
      problems(filled({ billing_model: "fixed_fee", markup_percent: "", monthly_fee: "9500" })),
    ).toEqual({});
  });

  it("asks for neither on a time-and-materials contract", () => {
    expect(problems(filled({ billing_model: "time_and_materials", markup_percent: "" }))).toEqual(
      {},
    );
  });

  it("asks for what the browser can know is missing, and no more", () => {
    expect(problems(blank)).toEqual({
      customer_id: "Choose the customer this contract is with.",
      name: "Enter a name for the contract.",
      markup_percent: "Enter the markup percentage.",
      start_date: "Choose the day the contract starts.",
    });
    // An end before the start, or a markup over the limit, is for the API to refuse.
    expect(problems(filled({ end_date: "2026-01-01", markup_percent: "900" }))).toEqual({});
  });

  it("sends the figure the billing model uses and clears the other", () => {
    const typedBoth = { markup_percent: "12.5", monthly_fee: "18400.00" };

    expect(billingTerms({ billing_model: "cost_plus", ...typedBoth })).toEqual({
      markup_percent: "12.5",
      monthly_fee: null,
    });
    expect(billingTerms({ billing_model: "fixed_fee", ...typedBoth })).toEqual({
      markup_percent: null,
      monthly_fee: "18400.00",
    });
    expect(billingTerms({ billing_model: "time_and_materials", ...typedBoth })).toEqual({
      markup_percent: null,
      monthly_fee: null,
    });
  });

  it("sends amounts as text and blanks as nothing", () => {
    const values = contractSchema.parse(
      filled({ name: "  Campus Custodial Services ", building_ids: ["building-1"] }),
    );

    expect(contractBody(values)).toEqual({
      customer_id: "customer-1",
      name: "Campus Custodial Services",
      contract_number: null, // left blank: the API generates the next one
      status: "draft",
      billing_model: "cost_plus",
      markup_percent: "12.5", // a string, never a number
      monthly_fee: null,
      currency: "USD",
      payment_terms_days: 30,
      start_date: "2026-12-01",
      end_date: null, // open-ended
      building_ids: ["building-1"],
      notes: null,
    });
  });
});

describe("the buildings a contract can cover", () => {
  const tower = { id: "building-1", name: "Calloway Tower", code: "BLD-0001" };
  const granite = { id: "building-2", name: "One Granite Plaza", code: "BLD-0002" };
  const annex = { id: "building-3", name: "Calloway Annex", code: "BLD-0003" };

  it("are the chosen customer's buildings, for a new contract", () => {
    expect(coverageOptions([annex, tower, granite], null, "customer-1")).toEqual([
      { ...annex, gone: false },
      { ...tower, gone: false },
      { ...granite, gone: false },
    ]);
    expect(coverageOptions([], null, "customer-1")).toEqual([]);
  });

  it("keep a building the saved contract covers after it was archived, marked as gone", () => {
    // One Granite Plaza is on the contract but no longer among the customer's buildings.
    expect(coverageOptions([annex, tower], saved, "customer-1")).toEqual([
      { ...annex, gone: false },
      { ...tower, gone: false },
      { ...granite, gone: true },
    ]);
  });

  it("do not list a covered building twice", () => {
    const options = coverageOptions([tower, granite], saved, "customer-1");
    expect(options.map((option) => option.id)).toEqual(["building-1", "building-2"]);
  });

  it("start again from the new customer's buildings when the customer is changed", () => {
    const elsewhere = { id: "building-9", name: "Larkspur Medical Pavilion", code: "BLD-0005" };

    expect(coverageOptions([elsewhere], saved, "customer-2")).toEqual([
      { ...elsewhere, gone: false },
    ]);
  });
});

describe("a contract's billing in the list", () => {
  const contract = { currency: "USD", markup_percent: null, monthly_fee: null } as const;

  it("names the figure the contract is billed from", () => {
    expect(
      billingSummary({ ...contract, billing_model: "cost_plus", markup_percent: "12.50" }),
    ).toBe("12.5% markup");
    expect(
      billingSummary({ ...contract, billing_model: "fixed_fee", monthly_fee: "18400.00" }),
    ).toBe("$18,400.00 a month");
    expect(
      billingSummary({
        ...contract,
        billing_model: "fixed_fee",
        monthly_fee: "6800.00",
        currency: "GBP",
      }),
    ).toBe("£6,800.00 a month");
  });

  it("says nothing where there is no fixed figure", () => {
    expect(billingSummary({ ...contract, billing_model: "time_and_materials" })).toBeNull();
    // A figure left over from an earlier billing model is not the one in use.
    expect(
      billingSummary({ ...contract, billing_model: "time_and_materials", markup_percent: "10.00" }),
    ).toBeNull();
  });
});
