import { NextResponse, type NextRequest } from "next/server";

import { signOut } from "@/auth";
import { serverApi } from "@/lib/api/server";
import { readSessionToken } from "@/lib/session-token";

/**
 * Where the app sends a browser whose session the API has stopped accepting.
 *
 * Anyone can open this URL, so it does not trust the caller: it asks the API first and
 * only clears the cookie if the session really is over. A valid session is sent back in.
 */
export async function GET(request: NextRequest) {
  const sessionToken = await readSessionToken(request);

  if (sessionToken) {
    let stillValid = false;
    try {
      const { response } = await serverApi(sessionToken).GET("/api/v1/auth/me");
      if (response.status !== 401) stillValid = true;
    } catch {
      stillValid = true; // The API is unreachable: that is not a reason to sign anyone out.
    }
    if (stillValid) return NextResponse.redirect(new URL("/", request.url));
    await signOut({ redirect: false });
  }

  return NextResponse.redirect(new URL("/login?reason=session_ended", request.url));
}
