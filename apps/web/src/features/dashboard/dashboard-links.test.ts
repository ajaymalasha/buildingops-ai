import { describe, expect, it } from "vitest";

import { figureLinks } from "./dashboard-links";

const CUSTOMER = "01a21553-cceb-7067-9798-bafbc0ea30aa";
const BUILDING = "01a21553-ccf9-7334-afae-c75e504000f6";

describe("where the figures that count records lead", () => {
  it("is each list, narrowed to the records counted", () => {
    expect(figureLinks({})).toEqual({
      invoicesOutstanding: "/invoices?status=issued",
      invoicesOverdue: "/invoices?overdue=true",
      // The timesheet queue opens on what is pending, and work orders on the backlog.
      timesheetsPending: "/timesheets",
      expensesPending: "/expenses?status=pending",
      workOrdersOpen: "/work-orders",
      workOrdersOverdue: "/work-orders?overdue=true",
      buildingsActive: "/buildings?status=active",
      employeesActive: "/employees?status=active",
      vendorsActive: "/vendors?status=active",
    });
  });

  it("carries a building to the lists that can be narrowed to one", () => {
    const links = figureLinks({ buildingId: BUILDING });

    expect(links.timesheetsPending).toBe(`/timesheets?building_id=${BUILDING}`);
    expect(links.expensesPending).toBe(`/expenses?status=pending&building_id=${BUILDING}`);
    expect(links.workOrdersOpen).toBe(`/work-orders?building_id=${BUILDING}`);
    expect(links.workOrdersOverdue).toBe(`/work-orders?overdue=true&building_id=${BUILDING}`);
    // Nothing lists invoices, or buildings, by building: no list would show what is counted.
    expect(links.invoicesOutstanding).toBeNull();
    expect(links.invoicesOverdue).toBeNull();
    expect(links.buildingsActive).toBeNull();
  });

  it("carries a customer to the lists that can be narrowed to one", () => {
    const links = figureLinks({ customerId: CUSTOMER });

    expect(links.invoicesOutstanding).toBe(`/invoices?status=issued&customer_id=${CUSTOMER}`);
    expect(links.invoicesOverdue).toBe(`/invoices?overdue=true&customer_id=${CUSTOMER}`);
    expect(links.buildingsActive).toBe(`/buildings?status=active&customer_id=${CUSTOMER}`);
    // Work orders, timesheets and expenses are not listed by customer.
    expect(links.timesheetsPending).toBeNull();
    expect(links.expensesPending).toBeNull();
    expect(links.workOrdersOpen).toBeNull();
    expect(links.workOrdersOverdue).toBeNull();
  });

  it("follows the building when it is one of the customer's", () => {
    const links = figureLinks({
      customerId: CUSTOMER,
      buildingId: BUILDING,
      buildingIsCustomers: true,
    });

    // The customer's building and the building are the same records.
    expect(links.workOrdersOpen).toBe(`/work-orders?building_id=${BUILDING}`);
    expect(links.timesheetsPending).toBe(`/timesheets?building_id=${BUILDING}`);
    expect(links.expensesPending).toBe(`/expenses?status=pending&building_id=${BUILDING}`);
    // The customer's invoices under the contracts that cover the building are not a list.
    expect(links.invoicesOutstanding).toBeNull();
    expect(links.buildingsActive).toBeNull();
  });

  it("leads nowhere when a building is not known to be the customer's", () => {
    const links = figureLinks({ customerId: CUSTOMER, buildingId: BUILDING });

    expect(links.workOrdersOpen).toBeNull();
    expect(links.timesheetsPending).toBeNull();
    expect(links.expensesPending).toBeNull();
    expect(links.invoicesOverdue).toBeNull();
  });

  it("always leads to everyone, because employees and vendors are never narrowed", () => {
    for (const narrowing of [{}, { customerId: CUSTOMER }, { buildingId: BUILDING }]) {
      const links = figureLinks(narrowing);
      expect(links.employeesActive).toBe("/employees?status=active");
      expect(links.vendorsActive).toBe("/vendors?status=active");
    }
  });
});
