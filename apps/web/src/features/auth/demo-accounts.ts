/**
 * Accounts created by `buildingops seed`, offered on the sign-in page when
 * NEXT_PUBLIC_DEMO_MODE is "true". Keep in step with apps/api/src/buildingops/seed/demo.py.
 */
export const DEMO_ACCOUNTS = [
  {
    email: "dana.whitfield@meridianfs.example",
    name: "Dana Whitfield",
    access: "Company admin · 2 organizations",
  },
  {
    email: "marcus.okafor@meridianfs.example",
    name: "Marcus Okafor",
    access: "Operations manager",
  },
  { email: "priya.raman@meridianfs.example", name: "Priya Raman", access: "Supervisor" },
  { email: "luis.ortega@meridianfs.example", name: "Luis Ortega", access: "Employee" },
  { email: "platform.admin@buildingops.example", name: "Jordan Reyes", access: "Platform admin" },
] as const;

export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
export const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "";
