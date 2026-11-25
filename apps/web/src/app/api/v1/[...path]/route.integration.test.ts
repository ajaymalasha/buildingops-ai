// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * These tests use the real `fetch` against a real HTTP server. The behaviour they pin down
 * lives inside Node's fetch, so a mocked fetch cannot show it.
 */

const state = vi.hoisted(() => ({ apiUrl: "" }));
vi.mock("@/lib/env", () => ({
  get API_INTERNAL_URL() {
    return state.apiUrl;
  },
}));
vi.mock("@/lib/session-token", () => ({ readSessionToken: async () => "expired-session-token" }));

import { POST } from "./route";

let api: Server;
const received: string[] = [];

beforeAll(async () => {
  api = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push(Buffer.concat(chunks).toString());
      // What the API says when a session has ended.
      response.writeHead(401, {
        "content-type": "application/problem+json",
        "www-authenticate": "Bearer",
      });
      response.end(
        JSON.stringify({ status: 401, code: "unauthenticated", title: "Authentication required" }),
      );
    });
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  state.apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => api.close(resolve));
});

describe("a write made with a session the API no longer accepts", () => {
  it("is answered with the API's 401, not reported as the API being unreachable", async () => {
    const request = new NextRequest("http://localhost:3000/api/v1/members", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "new@example.com" }),
    });

    const response = await POST(request, { params: Promise.resolve({ path: ["members"] }) });

    // A streamed request body makes fetch throw here ("expected non-null body source"),
    // which the handler would have turned into a 502.
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("unauthenticated");
    expect(received).toEqual(['{"email":"new@example.com"}']);
  });
});
