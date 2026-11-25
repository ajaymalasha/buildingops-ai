import createFetchClient from "openapi-fetch";
import createQueryClient from "openapi-react-query";

import { hardNavigate } from "@/lib/hard-navigation";

import type { paths } from "./schema";

/**
 * Typed API client for browser code.
 *
 * Requests go to this app's own `/api/v1/*` route, which attaches the session token on the
 * server and forwards to FastAPI. The token itself never reaches the browser.
 */
export const fetchClient = createFetchClient<paths>({ baseUrl: "" });

fetchClient.use({
  onResponse({ response }) {
    // The API no longer accepts the session (signed out elsewhere, expired, suspended).
    if (response.status === 401 && typeof window !== "undefined") {
      hardNavigate("/session/ended");
    }
    return response;
  },
});

/** TanStack Query bindings: `$api.useQuery("get", "/api/v1/members", ...)`. */
export const $api = createQueryClient(fetchClient);
