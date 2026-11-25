// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { SESSION_COOKIE } from "@/lib/auth-cookies";

import { proxy } from "./proxy";

function visit(path: string, cookie?: string) {
  return proxy(
    new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : undefined }),
  );
}

const redirectTarget = (response: Response) => response.headers.get("location");
const passedThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";

describe("proxy", () => {
  it("sends signed-out visitors to sign in and remembers where they were going", () => {
    const response = visit("/settings/members?role=supervisor");

    expect(response.status).toBe(307);
    expect(redirectTarget(response)).toBe(
      "http://localhost:3000/login?next=%2Fsettings%2Fmembers%3Frole%3Dsupervisor",
    );
  });

  it("adds no return path when the visitor was going to the home page", () => {
    expect(redirectTarget(visit("/"))).toBe("http://localhost:3000/login");
  });

  it("lets signed-out visitors reach the sign-in page", () => {
    expect(passedThrough(visit("/login"))).toBe(true);
  });

  it("lets a visitor with a session cookie into the app", () => {
    expect(passedThrough(visit("/settings/members", `${SESSION_COOKIE}=encrypted`))).toBe(true);
  });

  it("recognizes a session cookie that Auth.js split into chunks", () => {
    expect(passedThrough(visit("/", `${SESSION_COOKIE}.0=part; ${SESSION_COOKIE}.1=part`))).toBe(
      true,
    );
  });

  it("sends signed-in visitors away from the sign-in page", () => {
    const response = visit("/login", `${SESSION_COOKIE}=encrypted`);

    expect(redirectTarget(response)).toBe("http://localhost:3000/");
  });
});
