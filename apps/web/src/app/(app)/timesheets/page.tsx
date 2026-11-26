import type { Metadata } from "next";

import { TimesheetsPage } from "@/features/timesheets/timesheets-page";

export const metadata: Metadata = { title: "Timesheets" };

export default function Page() {
  return <TimesheetsPage />;
}
