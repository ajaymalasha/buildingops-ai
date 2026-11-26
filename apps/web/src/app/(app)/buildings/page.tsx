import type { Metadata } from "next";

import { BuildingsPage } from "@/features/buildings/buildings-page";

export const metadata: Metadata = { title: "Buildings" };

export default function Page() {
  return <BuildingsPage />;
}
