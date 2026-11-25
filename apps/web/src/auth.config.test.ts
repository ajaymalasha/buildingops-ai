// @vitest-environment node
import type { CredentialsConfig } from "next-auth/providers/credentials";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ POST: vi.fn(), serverApi: vi.fn() }));
vi.mock("@/lib/api/server", () => ({ serverApi: api.serverApi }));

import { authConfig } from "./auth.config";

const provider = authConfig.providers[0] as unknown as { options: CredentialsConfig };
const authorize = (credentials: Record<string, unknown>, headers: Record<string, string> = {}) =>
  provider.options.authorize!(credentials, new Request("http://localhost:3000/login", { headers }));

const loginResponse = {
  session_token: "opaque-session-token",
  expires_at: "2026-12-26T00:00:00Z",
  me: { user: { id: "user-1", email: "dana@example.com", full_name: "Dana Whitfield" } },
};

function apiAnswers(status: number, data?: unknown) {
  api.POST.mockResolvedValue({ data, response: new Response(null, { status }) });
}

beforeEach(() => {
  api.serverApi.mockReturnValue({ POST: api.POST });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  api.POST.mockReset();
  api.serverApi.mockReset();
});

describe("signing in", () => {
  it("exchanges the credentials for an API session and returns the user", async () => {
    apiAnswers(200, loginResponse);

    const user = await authorize(
      { email: "dana@example.com", password: "secret" },
      { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Test Browser" },
    );

    expect(user).toEqual({
      id: "user-1",
      email: "dana@example.com",
      name: "Dana Whitfield",
      sessionToken: "opaque-session-token",
    });
    expect(api.POST).toHaveBeenCalledWith("/api/v1/auth/login", {
      body: { email: "dana@example.com", password: "secret" },
    });
    // The API throttles and audits by the browser's address, so it has to be passed on.
    expect(api.serverApi).toHaveBeenCalledWith(null, {
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "Test Browser",
    });
  });

  it.each([
    [401, "invalid_credentials"],
    [422, "invalid_credentials"],
    [429, "rate_limited"],
    [500, "unavailable"],
  ])("turns an API %i into the %s failure", async (status, code) => {
    apiAnswers(status);

    await expect(authorize({ email: "a@b.co", password: "x" })).rejects.toMatchObject({ code });
  });

  it("reports the API being unreachable as unavailable, not as wrong credentials", async () => {
    api.POST.mockRejectedValue(new TypeError("fetch failed"));

    await expect(authorize({ email: "a@b.co", password: "x" })).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});

describe("session contents", () => {
  it("keeps the API session token inside the encrypted cookie", () => {
    const token = authConfig.callbacks.jwt({
      token: { sub: "user-1" },
      user: { id: "user-1", sessionToken: "opaque-session-token" },
    } as Parameters<typeof authConfig.callbacks.jwt>[0]);

    expect(token).toMatchObject({ sessionToken: "opaque-session-token" });
  });

  it("leaves the cookie alone on later requests", () => {
    const existing = { sub: "user-1", sessionToken: "opaque-session-token" };

    const token = authConfig.callbacks.jwt({ token: existing } as Parameters<
      typeof authConfig.callbacks.jwt
    >[0]);

    expect(token).toEqual(existing);
  });

  it("has no session callback, so nothing copies the token to where browser code can read it", () => {
    // `/api/auth/session` serves the session object to any script on the page. The default
    // session holds only name and email. A custom callback is the one way the token could
    // end up there, so adding one should be a deliberate change that fails this test.
    expect(Object.keys(authConfig.callbacks)).toEqual(["jwt"]);
  });
});

describe("signing out", () => {
  it("ends the API session as well as the browser session", async () => {
    api.POST.mockResolvedValue({ response: new Response(null, { status: 204 }) });

    await authConfig.events.signOut({ token: { sessionToken: "opaque-session-token" } });

    expect(api.serverApi).toHaveBeenCalledWith("opaque-session-token");
    expect(api.POST).toHaveBeenCalledWith("/api/v1/auth/logout");
  });

  it("still signs the browser out when the API cannot be reached", async () => {
    api.POST.mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      authConfig.events.signOut({ token: { sessionToken: "opaque-session-token" } }),
    ).resolves.toBeUndefined();
  });

  it("does nothing when there is no API session to end", async () => {
    await authConfig.events.signOut({ token: null });

    expect(api.serverApi).not.toHaveBeenCalled();
  });
});
