import type { SignInFailure } from "@/auth";

export const SIGN_IN_MESSAGES: Record<SignInFailure, string> = {
  invalid_credentials: "That email and password don't match an account.",
  rate_limited: "Too many failed attempts. Wait a few minutes, then try again.",
  unavailable: "We couldn't reach the server. Check that the API is running and try again.",
};

/**
 * Where to go after signing in. Only paths on this site are accepted, so a crafted
 * `?next=` link cannot send someone to another site once they have signed in.
 */
export function safeRedirectPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  if (next.startsWith("/login") || next.startsWith("/api/") || next.startsWith("/session/")) {
    return "/";
  }
  return next;
}
