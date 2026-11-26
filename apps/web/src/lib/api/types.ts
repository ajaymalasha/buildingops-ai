import type { components } from "./schema";

type Schemas = components["schemas"];

export type Me = Schemas["MeRead"];
export type Organization = Schemas["OrganizationRead"];
export type Member = Schemas["MemberRead"];
export type MembershipStatus = Schemas["MembershipStatus"];
export type AuditLogEntry = Schemas["AuditLogRead"];
export type PlatformOrganization = Schemas["PlatformOrganizationRead"];

export type Customer = Schemas["CustomerRead"];
export type CustomerStatus = Schemas["CustomerStatus"];
export type Building = Schemas["BuildingRead"];
export type BuildingStatus = Schemas["BuildingStatus"];
export type BuildingType = Schemas["BuildingType"];
export type Vendor = Schemas["VendorRead"];
export type VendorStatus = Schemas["VendorStatus"];
export type VendorCategory = Schemas["VendorCategory"];
export type JobRole = Schemas["JobRoleRead"];
export type Employee = Schemas["EmployeeRead"];
export type EmployeeStatus = Schemas["EmployeeStatus"];
export type EmploymentType = Schemas["EmploymentType"];
export type Assignment = Schemas["AssignmentRead"];
export type Contract = Schemas["ContractRead"];
export type ContractDetail = Schemas["ContractDetail"];
export type ContractStatus = Schemas["ContractStatus"];
export type BillingModel = Schemas["BillingModel"];
