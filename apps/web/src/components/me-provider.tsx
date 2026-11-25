"use client";

import { createContext, use } from "react";

import type { Me } from "@/lib/api/types";
import type { Permission } from "@/lib/permissions";

const MeContext = createContext<Me | null>(null);

export function MeProvider({ me, children }: { me: Me; children: React.ReactNode }) {
  return <MeContext value={me}>{children}</MeContext>;
}

/** The signed-in user, their active organization and their permissions. */
export function useMe(): Me {
  const me = use(MeContext);
  if (!me) throw new Error("useMe must be used inside the authenticated app shell");
  return me;
}

/**
 * Whether to offer an action. This only decides what the interface shows: the API checks
 * the permission again on every request.
 */
export function useCan(permission: Permission): boolean {
  return useMe().permissions.includes(permission);
}
