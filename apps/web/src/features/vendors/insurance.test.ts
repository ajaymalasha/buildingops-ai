import { describe, expect, it } from "vitest";

import { insuranceFlag, insuranceStatus } from "./insurance";

const TODAY = "2026-11-26";

describe("a vendor's insurance", () => {
  it("has nothing to flag while the certificate has more than thirty days to run", () => {
    expect(insuranceStatus("2026-12-27", TODAY)).toEqual({ state: "current" }); // 31 days
    expect(insuranceStatus("2027-11-26", TODAY)).toEqual({ state: "current" });
    expect(insuranceFlag({ state: "current" })).toBeNull();
  });

  it("is flagged as expiring through the thirtieth day, the day it expires included", () => {
    expect(insuranceStatus("2026-12-26", TODAY)).toEqual({ state: "expiring", days: 30 });
    expect(insuranceStatus("2026-12-05", TODAY)).toEqual({ state: "expiring", days: 9 });
    expect(insuranceStatus("2026-11-27", TODAY)).toEqual({ state: "expiring", days: 1 });
    // Valid through the day it expires on.
    expect(insuranceStatus(TODAY, TODAY)).toEqual({ state: "expiring", days: 0 });
  });

  it("has lapsed from the day after it expired", () => {
    expect(insuranceStatus("2026-11-25", TODAY)).toEqual({ state: "lapsed", days: 1 });
    expect(insuranceStatus("2026-11-08", TODAY)).toEqual({ state: "lapsed", days: 18 });
    expect(insuranceStatus("2025-11-26", TODAY)).toEqual({ state: "lapsed", days: 365 });
  });

  it("is missing when no certificate is on file", () => {
    expect(insuranceStatus(null, TODAY)).toEqual({ state: "missing" });
    expect(insuranceFlag({ state: "missing" })).toBeNull();
  });

  it("says when, in words", () => {
    expect(insuranceFlag({ state: "expiring", days: 9 })).toBe("Expires in 9 days");
    expect(insuranceFlag({ state: "expiring", days: 1 })).toBe("Expires tomorrow");
    expect(insuranceFlag({ state: "expiring", days: 0 })).toBe("Expires today");
    expect(insuranceFlag({ state: "lapsed", days: 1 })).toBe("Lapsed yesterday");
    expect(insuranceFlag({ state: "lapsed", days: 18 })).toBe("Lapsed 18 days ago");
  });
});
