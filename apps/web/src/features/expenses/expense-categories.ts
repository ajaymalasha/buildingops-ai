import type { ExpenseCategory } from "@/lib/api/types";

// What an expense can be for, and what each kind is called. They are kept apart from the
// form's schema so that a page which only names a category, as the dashboard does, does
// not load the form's validation along with the name.

export const EXPENSE_CATEGORIES = [
  "materials",
  "equipment",
  "subcontractor",
  "supplies",
  "travel",
  "other",
] as const;

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  materials: "Materials",
  equipment: "Equipment",
  subcontractor: "Subcontractor",
  supplies: "Supplies",
  travel: "Travel",
  other: "Other",
};
