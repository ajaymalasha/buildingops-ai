import type { Metadata } from "next";

import { PlatformOrganizationsPage } from "@/features/platform/platform-organizations-page";

export const metadata: Metadata = { title: "Organizations" };

export default function Page() {
  return <PlatformOrganizationsPage />;
}
