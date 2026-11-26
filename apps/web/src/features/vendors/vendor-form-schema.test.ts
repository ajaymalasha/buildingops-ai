import { describe, expect, it } from "vitest";

import { vendorBody, vendorDefaults, vendorSchema } from "./vendor-form-schema";

describe("the vendor form", () => {
  it("opens blank for a new vendor, with the defaults the API would apply", () => {
    expect(vendorDefaults(null)).toMatchObject({
      name: "",
      code: "",
      category: "janitorial",
      status: "active",
      country: "US",
      insurance_expires_on: "",
      payment_terms_days: "30",
    });
  });

  it("asks only for a name", () => {
    const result = vendorSchema.safeParse(vendorDefaults(null));

    expect(result.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ["name", "Enter the vendor's name."],
    ]);
  });

  it("sends blanks as nothing, the code included, so that one is generated", () => {
    const values = vendorSchema.parse({
      ...vendorDefaults(null),
      name: "  Dovemoor Mechanical Services ",
      category: "hvac",
      payment_terms_days: "45",
    });

    expect(vendorBody(values)).toEqual({
      name: "Dovemoor Mechanical Services",
      code: null,
      category: "hvac",
      status: "active",
      contact_name: null,
      email: null,
      phone: null,
      address_line1: null,
      address_line2: null,
      city: null,
      region: null,
      postal_code: null,
      country: "US",
      insurance_expires_on: null,
      payment_terms_days: 45,
      notes: null,
    });
  });

  it("sends the day insurance expires as the date that was picked", () => {
    const values = vendorSchema.parse({
      ...vendorDefaults(null),
      name: "Upright Elevator Works",
      insurance_expires_on: "2026-12-05",
    });

    expect(vendorBody(values).insurance_expires_on).toBe("2026-12-05");
  });
});
