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

/** Employees, by last name: everyone, or the people assigned to one building. */
export function useEmployeeOptions({
  buildingId,
  enabled = true,
}: Options & { buildingId?: string } = {}) {
  return $api.useQuery(
    "get",
    "/api/v1/employees",
    { params: { query: { building_id: buildingId, page_size: ALL } } },
    { enabled },
  );
}

/** Vendors, by name. */
export function useVendorOptions({ enabled = true }: Options = {}) {
  return $api.useQuery(
    "get",
    "/api/v1/vendors",
    { params: { query: { page_size: ALL } } },
    { enabled },
  );
}

/** Contracts, by name: all of them, or the ones that cover one building. */
export function useContractOptions({
  buildingId,
  enabled = true,
}: Options & { buildingId?: string } = {}) {
  return $api.useQuery(
    "get",
    "/api/v1/contracts",
    { params: { query: { building_id: buildingId, page_size: ALL } } },
    { enabled },
  );
}

/** The work orders raised at one building, newest first. */
export function useWorkOrderOptions({
  buildingId,
  enabled = true,
}: Options & { buildingId: string }) {
  return $api.useQuery(
    "get",
    "/api/v1/work-orders",
    { params: { query: { building_id: buildingId, page_size: ALL } } },
    { enabled },
  );
}
