import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { serverApi } from "@/lib/api/server";
import type { Me } from "@/lib/api/types";
import { readSessionToken } from "@/lib/session-token";

export const getSessionToken = cache(async (): Promise<string | null> => {
  return readSessionToken(await headers());
});

/**
 * The signed-in user, verified against the API on every request.
 *
 * The proxy only checks that a session cookie exists. This is the real check: the API
 * decides whether the session is still valid, so a revoked session is caught here.
 */
export const getMe = cache(async (): Promise<Me> => {
  const token = await getSessionToken();
  if (!token) redirect("/login");

  const { data, response } = await serverApi(token).GET("/api/v1/auth/me");
  if (response.status === 401) redirect("/session/ended");
  if (!data) {
    throw new Error(`The API could not load the session (HTTP ${response.status}).`);
  }
  return data;
});
