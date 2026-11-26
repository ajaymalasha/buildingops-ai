import { describe, expect, it } from "vitest";

import type { Building } from "@/lib/api/types";

import { buildingBody, buildingDefaults, buildingSchema } from "./building-form-schema";

const tower: Building = {
  id: "building-1",
  name: "Calloway Tower",
  code: "BLD-0001",
  building_type: "office",
  status: "active",
  address_line1: "410 Hollis Street",
  address_line2: null,
  city: "New York",
  region: "NY",
  postal_code: "10016",
  country: "US",
  square_feet: 412000,
  floors: 28,
  notes: null,
  customer: { id: "customer-1", name: "Calloway Property Group", code: "CUS-0001" },
  created_at: "2026-11-26T14:00:00Z",
  updated_at: "2026-11-26T14:00:00Z",
};

describe("the building form", () => {
  it("opens a new building as an active office with no customer chosen", () => {
    expect(buildingDefaults(null)).toMatchObject({
      customer_id: "",
      building_type: "office",
      status: "active",
      country: "US",
      square_feet: "",
      floors: "",
    });
  });

  it("starts a new building with the customer the list is showing", () => {
    expect(buildingDefaults(null, "customer-7").customer_id).toBe("customer-7");
    // An existing building keeps its own customer whatever the list is filtered to.
    expect(buildingDefaults(tower, "customer-7").customer_id).toBe("customer-1");
  });

  it("opens an existing building with its size as text", () => {
    expect(buildingDefaults(tower)).toMatchObject({
      name: "Calloway Tower",
      code: "BLD-0001",
      address_line1: "410 Hollis Street",
      address_line2: "",
      square_feet: "412000",
      floors: "28",
    });
  });

  it("asks for the customer, the name and where the building is", () => {
    const result = buildingSchema.safeParse(buildingDefaults(null));

    expect(result.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ["customer_id", "Choose the customer this building belongs to."],
      ["name", "Enter the building's name."],
      ["address_line1", "Enter the street address."],
      ["city", "Enter the city."],
    ]);
  });

  it("sends sizes as numbers and blanks as nothing", () => {
    const unchanged = buildingSchema.parse(buildingDefaults(tower));
    expect(buildingBody(unchanged)).toEqual({
      customer_id: "customer-1",
      name: "Calloway Tower",
      code: "BLD-0001",
      building_type: "office",
      status: "active",
      address_line1: "410 Hollis Street",
      address_line2: null,
      city: "New York",
      region: "NY",
      postal_code: "10016",
      country: "US",
      square_feet: 412000,
      floors: 28,
      notes: null,
    });

    const cleared = buildingBody({ ...unchanged, code: "", square_feet: "", floors: "" });
    expect(cleared).toMatchObject({ code: null, square_feet: null, floors: null });
  });
});
