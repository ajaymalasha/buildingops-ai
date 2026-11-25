import { CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { serverApi } from "@/lib/api/server";
import { USE_SECURE_COOKIES } from "@/lib/auth-cookies";

/**
 * Auth.js owns the browser session; FastAPI owns identity.
 *
 * Signing in sends the credentials to the API, which verifies them and returns an opaque
 * session token. Auth.js stores that token inside its encrypted, httpOnly cookie. Server
 * code reads it back with `readSessionToken` and sends it to the API as a bearer token.
 * The token is never put on the `session` object, because that object is readable by
 * browser code through `/api/auth/session`.
 */

export type SignInFailure = "invalid_credentials" | "rate_limited" | "unavailable";

class SignInError extends CredentialsSignin {
  constructor(code: SignInFailure) {
    super();
    this.code = code;
  }
}

declare module "next-auth" {
  interface User {
    sessionToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sessionToken?: string;
  }
}

/** Pass the browser's address and agent on, so the API throttles and audits the real client. */
function clientHeaders(request: Request): Record<string, string> {
  const forwarded: Record<string, string> = {};
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (address) forwarded["x-forwarded-for"] = address;
  const agent = request.headers.get("user-agent");
  if (agent) forwarded["user-agent"] = agent;
  return forwarded;
}

export const authConfig = {
  useSecureCookies: USE_SECURE_COOKIES,
  // Matches the API's absolute session limit. The API also enforces an idle limit.
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";

        let result;
        try {
          result = await serverApi(null, clientHeaders(request)).POST("/api/v1/auth/login", {
            body: { email, password },
          });
        } catch (error) {
          // The visitor sees a generic message; the reason belongs in the server log.
          console.error("Sign-in could not reach the API", error);
          throw new SignInError("unavailable");
        }

        const { data, response } = result;
        if (response.status === 429) throw new SignInError("rate_limited");
        if (response.status === 401 || response.status === 422) {
          throw new SignInError("invalid_credentials");
        }
        if (!data) {
          console.error(`Sign-in got an unexpected answer from the API: HTTP ${response.status}`);
          throw new SignInError("unavailable");
        }

        return {
          id: data.me.user.id,
          email: data.me.user.email,
          name: data.me.user.full_name,
          sessionToken: data.session_token,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.sessionToken) token.sessionToken = user.sessionToken;
      return token;
    },
  },
  events: {
    async signOut(message) {
      // End the API session too, so the token is useless even if it was copied.
      const sessionToken = "token" in message ? message.token?.sessionToken : undefined;
      if (!sessionToken) return;
      try {
        await serverApi(sessionToken).POST("/api/v1/auth/logout");
      } catch (error) {
        console.error("Could not end the API session during sign-out", error);
      }
    },
  },
} satisfies NextAuthConfig;
