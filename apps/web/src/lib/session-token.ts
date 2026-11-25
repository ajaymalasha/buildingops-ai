import "server-only";

import { getToken } from "next-auth/jwt";

import { USE_SECURE_COOKIES } from "@/lib/auth-cookies";

/**
 * Read the API session token out of the encrypted Auth.js cookie.
 *
 * The token is deliberately absent from the Auth.js `session` object, because that object
 * is served to browser code by `/api/auth/session`. Decrypting the cookie here, on the
 * server, is the only way to obtain it.
 */
export async function readSessionToken(source: Request | Headers): Promise<string | null> {
  const headers = source instanceof Request ? source.headers : source;
  const token = await getToken({
    req: { headers },
    secret: process.env.AUTH_SECRET,
    secureCookie: USE_SECURE_COOKIES,
  });
  return typeof token?.sessionToken === "string" ? token.sessionToken : null;
}
