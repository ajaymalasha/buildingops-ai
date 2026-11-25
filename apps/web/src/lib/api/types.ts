import type { components } from "./schema";

type Schemas = components["schemas"];

export type Me = Schemas["MeRead"];
export type Organization = Schemas["OrganizationRead"];
export type Member = Schemas["MemberRead"];
export type MembershipStatus = Schemas["MembershipStatus"];
export type AuditLogEntry = Schemas["AuditLogRead"];
export type PlatformOrganization = Schemas["PlatformOrganizationRead"];
