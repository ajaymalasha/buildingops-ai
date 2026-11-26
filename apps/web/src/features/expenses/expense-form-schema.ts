import { z } from "zod";

import type { components } from "@/lib/api/schema";
import type { Expense } from "@/lib/api/types";
import { blankToNull, optionalText, requiredAmount, requiredText } from "@/lib/form-fields";

import { EXPENSE_CATEGORIES } from "./expense-categories";

export { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "./expense-categories";

export const expenseSchema = z.object({
  description: requiredText(300, "Enter what was bought or paid for."),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: requiredAmount("Enter the amount."),
  incurred_on: z.string().min(1, "Choose the day the expense was incurred."),
  reference: optionalText(100),
  building_id: z.string(),
  contract_id: z.string(),
  vendor_id: z.string(),
  work_order_id: z.string(),
  billable: z.boolean(),
});

export type ExpenseValues = z.infer<typeof expenseSchema>;

export const EXPENSE_FIELDS = expenseSchema.keyof().options;

/**
 * The form as it opens: filled in from the expense being edited, or blank for a new one
 * apart from the day, which starts as today where the organization is.
 */
export function expenseDefaults(
  expense: Expense | null,
  { today }: { today: string },
): ExpenseValues {
  return {
    description: expense?.description ?? "",
    category: expense?.category ?? "supplies",
    amount: expense?.amount ?? "",
    incurred_on: expense?.incurred_on ?? today,
    reference: expense?.reference ?? "",
    building_id: expense?.building?.id ?? "",
    contract_id: expense?.contract?.id ?? "",
    vendor_id: expense?.vendor?.id ?? "",
    work_order_id: expense?.work_order?.id ?? "",
    billable: expense?.billable ?? true,
  };
}

type BodyOptions = {
  /**
   * Which of the choices from other lists the form offered. It leaves one out for someone
   * who may not read that list, and what the expense holds is then left as it is.
   */
  offered: { contract: boolean; vendor: boolean; workOrder: boolean };
};

/**
 * What is sent to the API, for a new expense and for a change to a pending one alike. The
 * amount goes as the text that was typed: money is never a floating-point number. The
 * currency is not sent. An expense is in the organization's.
 */
export function expenseBody(
  values: ExpenseValues,
  { offered }: BodyOptions,
): components["schemas"]["ExpenseCreate"] {
  return {
    description: values.description,
    category: values.category,
    amount: values.amount,
    incurred_on: values.incurred_on,
    reference: blankToNull(values.reference),
    building_id: blankToNull(values.building_id),
    billable: values.billable,
    ...(offered.contract ? { contract_id: blankToNull(values.contract_id) } : {}),
    ...(offered.vendor ? { vendor_id: blankToNull(values.vendor_id) } : {}),
    ...(offered.workOrder ? { work_order_id: blankToNull(values.work_order_id) } : {}),
  };
}

/** What a list shows under the building an expense was for: its work order and contract. */
export function bookedTo(expense: Pick<Expense, "work_order" | "contract">): string | null {
  const parts = [expense.work_order?.number, expense.contract?.contract_number].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
