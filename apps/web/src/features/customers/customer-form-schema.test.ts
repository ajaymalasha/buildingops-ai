import { describe, expect, it } from "vitest";

import type { Customer } from "@/lib/api/types";

import { customerBody, customerDefaults, customerSchema } from "./customer-form-schema";

const calloway: Customer = {
  id: "customer-1",
  name: "Calloway Property Group",
  code: "CUS-0001",
  status: "active",
  contact_name: "Sofia Delgado",
  email: "sofia.delgado@callowaypg.example",
  phone: "(212) 555-0160",
  address_line1: "410 Hollis Street",
  address_line2: "Suite 2200",
  city: "New York",
  region: "NY",
  postal_code: "10016",
  country: "US",
  payment_terms_days: 45,
  notes: null,
  building_count: 4,
  created_at: "2026-11-26T14:00:00Z",
  updated_at: "2026-11-26T14:00:00Z",
};

describe("the customer form", () => {
  it("opens a new customer as active on thirty-day terms", () => {
    expect(customerDefaults(null)).toMatchObject({
      name: "",
      code: "",
      status: "active",
      country: "US",
      payment_terms_days: "30",
    });
  });

  it("asks only for a name", () => {
    const result = customerSchema.safeParse(customerDefaults(null));

    expect(result.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ["name", "Enter the customer's name."],
    ]);
  });

  it("leaves a blank code out, so that the API generates the next one", () => {
    const values = customerSchema.parse({ ...customerDefaults(null), name: "Harborline Offices" });

    expect(customerBody(values)).toMatchObject({
      name: "Harborline Offices",
      code: null,
      contact_name: null,
      email: null,
      address_line1: null,
      payment_terms_days: 30,
      notes: null,
    });
  });

  it("sends an existing customer back as it was when nothing is changed", () => {
    const values = customerSchema.parse(customerDefaults(calloway));

    expect(customerBody(values)).toEqual({
      name: "Calloway Property Group",
      code: "CUS-0001",
      status: "active",
      contact_name: "Sofia Delgado",
      email: "sofia.delgado@callowaypg.example",
      phone: "(212) 555-0160",
      address_line1: "410 Hollis Street",
      address_line2: "Suite 2200",
      city: "New York",
      region: "NY",
      postal_code: "10016",
      country: "US",
      payment_terms_days: 45,
      notes: null,
    });
  });
});
