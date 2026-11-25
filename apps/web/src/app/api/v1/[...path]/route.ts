import type { NextRequest } from "next/server";

import { API_INTERNAL_URL } from "@/lib/env";
import { readSessionToken } from "@/lib/session-token";

/**
 * Authenticated pass-through from the browser to FastAPI.
 *
 * Browser code calls `/api/v1/...` on this origin with its session cookie. This handler
 * decrypts the cookie, attaches the API session token as a bearer credential and forwards
 * the request. The upstream origin is fixed, so the credential can only go to the API.
 */

// These are driven by server-side Auth.js flows, which keep the token out of the browser
// and keep the cookie and the API session in step.
const SERVER_ONLY_PATHS = new Set(["auth/login", "auth/logout", "auth/switch-organization"]);

const REQUEST_HEADERS = ["content-type", "accept", "user-agent", "x-request-id"];
const RESPONSE_HEADERS = ["content-type", "content-disposition", "retry-after", "x-request-id"];
const UPSTREAM_TIMEOUT_MS = 60_000;
// Bodies are held in memory (see below), so they are capped.
const MAX_BODY_BYTES = 10 * 1024 * 1024;

function problem(status: number, code: string, title: string): Response {
  return Response.json(
    { type: "about:blank", title, status, code },
    {
      status,
      headers: { "content-type": "application/problem+json", "cache-control": "no-store" },
    },
  );
}

/** State-changing requests must come from this site's own pages (CSRF defence in depth). */
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * A path segment that could change which endpoint is reached once the URL is normalized
 * or decoded again upstream: `..`, `.`, or anything containing a separator.
 */
function isUnsafeSegment(segment: string): boolean {
  return segment === "." || segment === ".." || /[/\\]/.test(segment);
}

async function forward(request: NextRequest, context: RouteContext<"/api/v1/[...path]">) {
  const { path } = await context.params;
  // Checked before the allow/deny decision below, so that decision is made about the
  // endpoint that will really be called, not about a path that normalizes into another.
  if (path.some(isUnsafeSegment)) return problem(400, "bad_request", "Invalid path");
  if (SERVER_ONLY_PATHS.has(path.join("/"))) return problem(404, "not_found", "Not found");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  if (hasBody && !isSameOrigin(request)) {
    return problem(403, "cross_origin_request", "Cross-origin request refused");
  }

  const sessionToken = await readSessionToken(request);
  if (!sessionToken) return problem(401, "unauthenticated", "Sign in to continue");

  const upstreamUrl = new URL(
    `/api/v1/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`,
    API_INTERNAL_URL,
  );

  // Send only what the API needs. In particular, never the browser's cookies.
  const headers = new Headers({ authorization: `Bearer ${sessionToken}` });
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const clientAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (clientAddress) headers.set("x-forwarded-for", clientAddress);

  // The body is read into memory rather than streamed through. Node's fetch has to re-read
  // a request body when the server answers 401, and fails outright if the body was a
  // stream, which would turn "your session has ended" into "the API is unreachable".
  let body: ArrayBuffer | undefined;
  if (hasBody) {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return problem(413, "payload_too_large", "The request is too large");
    }
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return problem(413, "payload_too_large", "The request is too large");
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`API request failed: ${request.method} ${upstreamUrl.pathname}`, error);
    return problem(502, "upstream_unavailable", "The API is not reachable");
  }

  const responseHeaders = new Headers({ "cache-control": "no-store" });
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST, forward as PUT };
