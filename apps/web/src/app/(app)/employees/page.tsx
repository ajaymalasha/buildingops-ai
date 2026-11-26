import type { Metadata } from "next";

import { EmployeesPage } from "@/features/employees/employees-page";

export const metadata: Metadata = { title: "Employees" };

export default function Page() {
  return <EmployeesPage />;
}
