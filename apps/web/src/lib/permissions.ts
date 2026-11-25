import type { components } from "@/lib/api/schema";

export type Permission = components["schemas"]["Permission"];
export type Role = components["schemas"]["Role"];

export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: "Platform admin",
  company_admin: "Company admin",
  operations_manager: "Operations manager",
  supervisor: "Supervisor",
  employee: "Employee",
  customer: "Customer",
  vendor: "Vendor",
};

/** What each role is for, shown where a role is chosen. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  platform_admin: "Operates the platform across all organizations.",
  company_admin: "Full access, including members and organization settings.",
  operations_manager: "Runs day-to-day operations across all buildings.",
  supervisor: "Leads teams on site and approves their time.",
  employee: "Sees their own schedule, time and training.",
  customer: "Portal access to their own buildings, requests and invoices.",
  vendor: "Portal access to the work assigned to them.",
};

/** Roles that can be given to a member of an organization. */
export const ASSIGNABLE_ROLES: Role[] = [
  "company_admin",
  "operations_manager",
  "supervisor",
  "employee",
  "customer",
  "vendor",
];
