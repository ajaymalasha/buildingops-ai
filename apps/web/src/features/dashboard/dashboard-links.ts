/**
 * Where a figure that counts records leads: the list, narrowed to exactly those records.
 *
 * Each list takes its filters from its URL, so a link is that URL. A figure gets no link
 * at all when the dashboard is narrowed by something its list cannot be narrowed by. A
 * list of other records than the ones counted would be worse than no list.
 */
export type FigureLinks = {
  invoicesOutstanding: string | null;
  invoicesOverdue: string | null;
  timesheetsPending: string | null;
  expensesPending: string | null;
  workOrdersOpen: string | null;
  workOrdersOverdue: string | null;
  buildingsActive: string | null;
  employeesActive: string;
  vendorsActive: string;
};

type Narrowing = {
  customerId?: string;
  buildingId?: string;
  /**
   * Whether the building is one of the customer's, when both are chosen. Only then do the
   * two together select the building's records, which a list can show.
   */
  buildingIsCustomers?: boolean;
};

function href(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export function figureLinks({
  customerId,
  buildingId,
  buildingIsCustomers = false,
}: Narrowing): FigureLinks {
  // Work orders, timesheets and expenses are listed by building, never by customer. A
  // customer's building narrows them as far as the customer and the building do together.
  const byBuilding = !customerId || (Boolean(buildingId) && buildingIsCustomers);
  // Invoices are listed by customer. Nothing lists them by building.
  const byCustomer = !buildingId;
  const at = (path: string, params: Record<string, string | undefined> = {}) =>
    byBuilding ? href(path, { ...params, building_id: buildingId }) : null;
  const of = (path: string, params: Record<string, string | undefined>) =>
    byCustomer ? href(path, { ...params, customer_id: customerId }) : null;

  return {
    invoicesOutstanding: of("/invoices", { status: "issued" }),
    invoicesOverdue: of("/invoices", { overdue: "true" }),
    // The queue opens on what is pending, and work orders on the backlog.
    timesheetsPending: at("/timesheets"),
    expensesPending: at("/expenses", { status: "pending" }),
    workOrdersOpen: at("/work-orders"),
    workOrdersOverdue: at("/work-orders", { overdue: "true" }),
    buildingsActive: of("/buildings", { status: "active" }),
    // Never narrowed: the dashboard counts everyone, whatever it is narrowed to.
    employeesActive: "/employees?status=active",
    vendorsActive: "/vendors?status=active",
  };
}
