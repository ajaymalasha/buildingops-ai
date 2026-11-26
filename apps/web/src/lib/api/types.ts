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

export type WorkOrder = Schemas["WorkOrderRead"];
export type WorkOrderDetail = Schemas["WorkOrderDetail"];
export type WorkOrderActivity = Schemas["WorkOrderActivityRead"];
export type WorkOrderStatus = Schemas["WorkOrderStatus"];
export type WorkOrderPriority = Schemas["WorkOrderPriority"];
export type WorkOrderCategory = Schemas["WorkOrderCategory"];
export type WorkOrderSource = Schemas["WorkOrderSource"];
export type Shift = Schemas["ShiftRead"];
export type ShiftStatus = Schemas["ShiftStatus"];
/** Where a timesheet or an expense stands with whoever approves it. */
export type DecisionStatus = Schemas["DecisionStatus"];
export type Timesheet = Schemas["TimesheetRead"];
export type TimesheetSource = Schemas["TimesheetSource"];
export type TimesheetSummary = Schemas["TimesheetSummary"];
export type Expense = Schemas["ExpenseRead"];
export type ExpenseCategory = Schemas["ExpenseCategory"];
export type Invoice = Schemas["InvoiceRead"];
export type InvoiceDetail = Schemas["InvoiceDetail"];
export type InvoiceLine = Schemas["InvoiceLineRead"];
export type InvoiceStatus = Schemas["InvoiceStatus"];
export type Payment = Schemas["PaymentRead"];
export type PaymentMethod = Schemas["PaymentMethod"];

export type DashboardSummary = Schemas["DashboardSummary"];
export type DashboardTrends = Schemas["DashboardTrends"];
export type DashboardContracts = Schemas["DashboardContracts"];
export type DashboardBuildings = Schemas["DashboardBuildings"];
export type DashboardWorkOrders = Schemas["DashboardWorkOrders"];
/** An amount for a period, beside the same amount for the period before it. */
export type MoneyFigure = Schemas["MoneyFigure"];
export type MonthTrend = Schemas["MonthTrend"];
/** Revenue, costs and margin of one contract, or of several together. */
export type ProfitLine = Schemas["ProfitLine"];
export type ContractProfit = Schemas["ContractProfit"];
export type BuildingCost = Schemas["BuildingCost"];
export type CostShare = Schemas["CostShare"];
