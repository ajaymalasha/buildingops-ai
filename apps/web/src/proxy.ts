import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth-cookies";

/**
 * An optimistic check only: is there a session cookie at all?
 *
 * It keeps signed-out visitors away from the app and signed-in users away from the sign-in
 * page without a network call. It is not the security boundary. The API validates the
 * session on every request, and `getMe()` handles a cookie the API no longer accepts.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession =
    request.cookies.has(SESSION_COOKIE) || request.cookies.has(`${SESSION_COOKIE}.0`);
  const isSignIn = pathname === "/login";

  if (!hasSession && !isSignIn) {
    const signIn = new URL("/login", request.url);
    if (pathname !== "/") signIn.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }
  if (hasSession && isSignIn) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Pages only. API routes authenticate themselves; static files need no session.
  matcher: ["/((?!api/|session/|_next/|.*\\..*).*)"],
};
