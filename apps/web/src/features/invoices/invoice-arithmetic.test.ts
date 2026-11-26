import { describe, expect, it } from "vitest";

import type { InvoiceLine, Payment } from "@/lib/api/types";

import { invoiceArithmetic } from "./invoice-arithmetic";

function line(position: number, amount: string, changes: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: `line-${position}`,
    position,
    kind: "labor",
    description: "Labor: 1,284.50 approved hours",
    quantity: "1.00",
    unit_price: amount,
    amount,
    ...changes,
  };
}

function payment(id: string, amount: string): Payment {
  return { id, amount, received_on: "2026-11-12", method: "ach", reference: "ACH 482913" };
}

// A cost-plus invoice as the API stores it: costs at cost, then the markup on them as a
// line of its own. Its total is the subtotal plus the markup, and there is no tax.
const costPlus = {
  lines: [
    line(1, "26412.37"),
    line(2, "1840.50", { kind: "materials", description: "Materials and supplies" }),
    line(3, "312.75", { kind: "equipment", description: "Equipment" }),
    line(4, "3570.70", { kind: "markup", description: "Markup at 12.50%" }),
  ],
  tax_amount: "0.00",
  total: "32136.32",
  payments: [payment("p1", "12854.53"), payment("p2", "19281.79")],
  amount_paid: "32136.32",
};

describe("an invoice's arithmetic, as the drawer shows it", () => {
  it("adds the lines up to the invoice's total", () => {
    const sums = invoiceArithmetic(costPlus);

    expect(sums.linesTotal).toBe("32136.32");
    expect(sums.addsUp).toBe(true);
    expect(sums.hasTax).toBe(false);
  });

  it("adds the payments up to what the invoice records as paid", () => {
    const sums = invoiceArithmetic(costPlus);

    expect(sums.paymentsTotal).toBe("32136.32");
    expect(sums.paymentsAddUp).toBe(true);
  });

  it("adds up exactly where floating point would not", () => {
    // 0.1 + 0.2 + 0.7 is 0.9999999999999999 in floating point.
    const sums = invoiceArithmetic({
      lines: [line(1, "0.10"), line(2, "0.20"), line(3, "0.70")],
      tax_amount: "0.00",
      total: "1.00",
      payments: [],
      amount_paid: "0.00",
    });

    expect(sums.linesTotal).toBe("1.00");
    expect(sums.addsUp).toBe(true);
  });

  it("counts tax between the lines and the total", () => {
    const taxed = { ...costPlus, tax_amount: "2651.25", total: "34787.57" };

    const sums = invoiceArithmetic(taxed);

    expect(sums.hasTax).toBe(true);
    expect(sums.linesTotal).toBe("32136.32"); // the lines alone
    expect(sums.addsUp).toBe(true); // with the tax, they come to the total
    expect(invoiceArithmetic({ ...taxed, total: "32136.32" }).addsUp).toBe(false);
  });

  it("says so when the lines do not come to the total", () => {
    const sums = invoiceArithmetic({ ...costPlus, total: "32136.33" });

    expect(sums.linesTotal).toBe("32136.32");
    expect(sums.addsUp).toBe(false);
  });

  it("says so when the payments listed are not what is recorded as paid", () => {
    const sums = invoiceArithmetic({ ...costPlus, amount_paid: "12854.53" });

    expect(sums.paymentsTotal).toBe("32136.32");
    expect(sums.paymentsAddUp).toBe(false);
  });

  it("has nothing paid on an invoice with no payments, which is as it should be", () => {
    const unpaid = invoiceArithmetic({ ...costPlus, payments: [], amount_paid: "0.00" });

    expect(unpaid.paymentsTotal).toBe("0.00");
    expect(unpaid.paymentsAddUp).toBe(true);
  });

  it("handles a single fixed fee, and an invoice with no lines at all", () => {
    const fixedFee = invoiceArithmetic({
      lines: [line(1, "18400.00", { kind: "fee", description: "Monthly service fee" })],
      tax_amount: "0.00",
      total: "18400.00",
      payments: [],
      amount_paid: "0.00",
    });
    expect(fixedFee).toMatchObject({ linesTotal: "18400.00", addsUp: true });

    const empty = invoiceArithmetic({
      lines: [],
      tax_amount: "0.00",
      total: "0.00",
      payments: [],
      amount_paid: "0.00",
    });
    expect(empty).toMatchObject({ linesTotal: "0.00", addsUp: true });
  });

  it("does not claim a sum when an amount is not a number", () => {
    const sums = invoiceArithmetic({ ...costPlus, lines: [line(1, "n/a")] });

    expect(sums.linesTotal).toBeNull();
    expect(sums.addsUp).toBe(false);
  });
});
