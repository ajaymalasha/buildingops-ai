import type { Metadata } from "next";

import { ContractsPage } from "@/features/contracts/contracts-page";

export const metadata: Metadata = { title: "Contracts" };

export default function Page() {
  return <ContractsPage />;
}
