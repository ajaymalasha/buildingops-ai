import "server-only";

/** Where the Next.js server reaches the FastAPI service. Never sent to the browser. */
export const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000").replace(
  /\/+$/,
  "",
);
