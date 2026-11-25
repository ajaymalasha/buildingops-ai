import "server-only";

import createClient from "openapi-fetch";

import { API_INTERNAL_URL } from "@/lib/env";

import type { paths } from "./schema";

/**
 * Send a request with its body as bytes instead of as a stream.
 *
 * When the API answers 401, Node's fetch re-reads the request body, and fails with
 * "expected non-null body source" if that body was a one-shot stream. The caller would
 * then see a network failure where the API had given a perfectly clear answer. Bytes can
 * be read again.
 */
async function fetchWithReplayableBody(request: Request): Promise<Response> {
  return fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body === null ? undefined : await request.arrayBuffer(),
    cache: "no-store",
    signal: request.signal,
  });
}

/** Typed API client for server-side code. Calls FastAPI directly with the bearer token. */
export function serverApi(sessionToken?: string | null, headers?: Record<string, string>) {
  return createClient<paths>({
    baseUrl: API_INTERNAL_URL,
    fetch: fetchWithReplayableBody,
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...headers,
    },
  });
}
