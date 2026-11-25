"use server";

import { AuthError } from "next-auth";

import { signIn, signOut, type SignInFailure } from "@/auth";
import { problemMessage } from "@/lib/api/problem";
import { serverApi } from "@/lib/api/server";
import { getSessionToken } from "@/lib/session";

import { safeRedirectPath, SIGN_IN_MESSAGES } from "./sign-in";

/** `email` is echoed back so the field keeps its value after a failed attempt. */
export type SignInState = { error: string; email: string } | undefined;

export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: safeRedirectPath(String(formData.get("next") ?? "")),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      const code = (error as AuthError & { code?: string }).code as SignInFailure | undefined;
      return {
        error: SIGN_IN_MESSAGES[code ?? "unavailable"] ?? SIGN_IN_MESSAGES.unavailable,
        email,
      };
    }
    throw error; // A successful sign-in redirects by throwing; let that through.
  }
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Change the active organization for this session.
 *
 * Runs on the server because it changes what the session token means. The caller reloads
 * the page afterwards so that nothing cached from the previous organization survives.
 */
export async function switchOrganizationAction(organizationId: string): Promise<ActionResult> {
  const sessionToken = await getSessionToken();
  if (!sessionToken) return { ok: false, error: "Your session has ended. Sign in again." };

  const { error } = await serverApi(sessionToken).POST("/api/v1/auth/switch-organization", {
    body: { organization_id: organizationId },
  });
  if (error) return { ok: false, error: problemMessage(error, "Could not switch organization.") };
  return { ok: true };
}
