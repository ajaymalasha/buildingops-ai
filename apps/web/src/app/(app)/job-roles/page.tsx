import type { Metadata } from "next";

import { JobRolesPage } from "@/features/job-roles/job-roles-page";

export const metadata: Metadata = { title: "Job roles" };

export default function Page() {
  return <JobRolesPage />;
}
