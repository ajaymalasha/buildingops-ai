import type { Metadata } from "next";

import { OrganizationSettingsPage } from "@/features/organization/organization-settings-page";

export const metadata: Metadata = { title: "Organization" };

export default function Page() {
  return <OrganizationSettingsPage />;
}
