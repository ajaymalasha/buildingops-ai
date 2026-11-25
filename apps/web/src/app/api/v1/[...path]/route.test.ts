// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readSessionToken = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
vi.mock("@/lib/session-token", () => ({ readSessionToken }));

import { DELETE, GET, PATCH, POST } from "./route";

type Handler = typeof GET;
type Init = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  segments?: string[];
};

const upstream = vi.fn<typeof fetch>();

function call(handler: Handler, path: string, init: Init = {}) {
  const request = new NextRequest(`http://localhost:3000/api/v1/${path}`, {
    method: init.method ?? "GET",
    headers: { host: "localhost:3000", ...init.headers },
    body: init.body,
  });
  const segments = init.segments ?? path.split("?")[0]!.split("/");
  return handler(request, { params: Promise.resolve({ path: segments }) });
}

function sent(): { url: URL; init: RequestInit; headers: Headers } {
  const [url, init] = upstream.mock.calls[0]!;
  return { url: url as URL, init: init!, headers: new Headers(init!.headers) };
}

const sameOrigin = { origin: "http://localhost:3000", "content-type": "application/json" };

beforeEach(() => {
  vi.stubGlobal("fetch", upstream);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  readSessionToken.mockResolvedValue("session-token-123");
  upstream.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-1",
        "set-cookie": "planted=1",
        "x-internal-detail": "do-not-leak",
      },
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  upstream.mockReset();
  readSessionToken.mockReset();
});

describe("forwarding", () => {
  it("sends the request to the API with the session token as a bearer credential", async () => {
    const response = await call(GET, "members?page=2&q=ann");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const { url, init, headers } = sent();
    expect(url.href).toBe("http://127.0.0.1:8000/api/v1/members?page=2&q=ann");
    expect(headers.get("authorization")).toBe("Bearer session-token-123");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe("manual");
    expect(init.cache).toBe("no-store");
  });

  it("never forwards the browser's cookies or arbitrary headers", async () => {
    await call(GET, "members", {
      headers: {
        cookie: "authjs.session-token=encrypted; other=1",
        authorization: "Bearer supplied-by-the-page",
        "x-anything": "else",
        accept: "application/json",
        "user-agent": "Test Browser",
        "x-request-id": "trace-9",
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      },
    });

    const { headers } = sent();
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-anything")).toBeNull();
    expect(headers.get("authorization")).toBe("Bearer session-token-123");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("user-agent")).toBe("Test Browser");
    expect(headers.get("x-request-id")).toBe("trace-9");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.7"); // the client, not the chain
  });

  it("returns only an allowlist of upstream headers and marks the response uncacheable", async () => {
    const response = await call(GET, "members");

    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-internal-detail")).toBeNull();
  });

  it("forwards the body of a write as bytes, which fetch can re-read", async () => {
    await call(PATCH, "members/abc", {
      method: "PATCH",
      headers: sameOrigin,
      body: '{"title":"Lead"}',
    });

    const { init, headers } = sent();
    expect(init.method).toBe("PATCH");
    expect(init.body).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"title":"Lead"}');
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("refuses a body larger than it is willing to hold in memory", async () => {
    const response = await call(POST, "members", {
      method: "POST",
      headers: { ...sameOrigin, "content-length": String(11 * 1024 * 1024) },
      body: "{}",
    });

    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe("payload_too_large");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("passes upstream errors through unchanged", async () => {
    upstream.mockResolvedValue(
      new Response(JSON.stringify({ status: 409, code: "conflict", title: "Conflict" }), {
        status: 409,
        headers: { "content-type": "application/problem+json" },
      }),
    );

    const response = await call(POST, "members", {
      method: "POST",
      headers: sameOrigin,
      body: "{}",
    });

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect((await response.json()).code).toBe("conflict");
  });

  it("answers 502 when the API cannot be reached", async () => {
    upstream.mockRejectedValue(new TypeError("fetch failed"));

    const response = await call(GET, "members");

    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("upstream_unavailable");
  });
});

describe("authentication", () => {
  it("refuses requests that have no session, without calling the API", async () => {
    readSessionToken.mockResolvedValue(null);

    const response = await call(GET, "members");

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("unauthenticated");
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(["auth/login", "auth/logout", "auth/switch-organization"])(
    "does not expose %s, which would hand the session token to browser code",
    async (path) => {
      const response = await call(POST, path, { method: "POST", headers: sameOrigin, body: "{}" });

      expect(response.status).toBe(404);
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a dot-dot segment", ["members", "..", "auth", "login"]],
    ["a single-dot segment", [".", "auth", "login"]],
    ["a segment that decodes to a slash", ["auth/login"]],
    ["a segment with a backslash", ["auth\\login"]],
  ])("rejects %s instead of letting it reach another endpoint", async (_label, segments) => {
    const response = await call(POST, "x", {
      method: "POST",
      headers: sameOrigin,
      body: "{}",
      segments,
    });

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("keeps the request inside /api/v1 on the API origin, whatever the segments contain", async () => {
    await call(GET, "x", { segments: ["members", "id with space?&#"] });

    const { url } = sent();
    expect(url.origin).toBe("http://127.0.0.1:8000");
    expect(url.pathname).toBe("/api/v1/members/id%20with%20space%3F%26%23");
    expect(url.search).toBe("");
  });
});

describe("cross-site request forgery", () => {
  const write = { method: "POST", body: "{}" };

  it("refuses a write from another origin", async () => {
    const response = await call(POST, "members", {
      ...write,
      headers: { origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("cross_origin_request");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a write that does not say where it came from", async () => {
    const response = await call(DELETE, "members/abc", { method: "DELETE" });

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("accepts a write from this site", async () => {
    const byOrigin = await call(POST, "members", { ...write, headers: sameOrigin });
    const byFetchMetadata = await call(POST, "members", {
      ...write,
      headers: { "sec-fetch-site": "same-origin" },
    });

    expect(byOrigin.status).toBe(200);
    expect(byFetchMetadata.status).toBe(200);
  });

  it("compares against the public host when behind a reverse proxy", async () => {
    const response = await call(POST, "members", {
      ...write,
      headers: { origin: "https://app.example.com", "x-forwarded-host": "app.example.com" },
    });

    expect(response.status).toBe(200);
  });

  it("does not require an origin for reads", async () => {
    expect((await call(GET, "members")).status).toBe(200);
  });
});
