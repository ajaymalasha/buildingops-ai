"use client";

import { $api } from "@/lib/api/client";

/**
 * The records a select offers, loaded whole from the list endpoints.
 *
 * A filter in a toolbar and the field in a form ask for the same list, so they share one
 * request. Two hundred is the most the API returns at once, and enough for a native
 * select; an organization with more of something will need a search box here instead.
 */
const ALL = 200;

type Options = { enabled?: boolean };

/** Customers, by name. */
export function useCustomerOptions({ enabled = true }: Options = {}) {
  return $api.useQuery(
    "get",
    "/api/v1/customers",
    { params: { query: { page_size: ALL } } },
    { enabled },
  );
}

/** Buildings, by name: all of them, or one customer's. */
export function useBuildingOptions({
  customerId,
  enabled = true,
}: Options & { customerId?: string } = {}) {
  return $api.useQuery(
    "get",
    "/api/v1/buildings",
    { params: { query: { customer_id: customerId, page_size: ALL } } },
    { enabled },
  );
}

/** Job roles, by name. */
export function useJobRoleOptions({ enabled = true }: Options = {}) {
  return $api.useQuery(
    "get",
    "/api/v1/job-roles",
    { params: { query: { page_size: ALL } } },
    { enabled },
  );
}

/** Employees whose job role is a supervisory one: the people someone can report to. */
export function useSupervisorOptions({ enabled = true }: Options = {}) {
  return $api.useQuery(
    "get",
    "/api/v1/employees",
    { params: { query: { supervisory: true, page_size: ALL } } },
    { enabled },
  );
}
