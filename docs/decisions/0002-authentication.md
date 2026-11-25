# 0002. Authentication: server-side sessions behind Auth.js

## Context

The interface is a Next.js app and the business logic is a separate FastAPI service. A
session cookie on the web origin does not authenticate requests to the API, so the two
need an explicit mechanism. The common choice is short-lived JWT access tokens plus
refresh tokens. With Auth.js that has a known weak point: a token refreshed while a server
component renders cannot be written back to the cookie, and rotated refresh tokens then
fail on the next request, signing people out at random.

## Decision

- The API is the identity authority. It verifies passwords (Argon2id) and issues an
  **opaque session token**, storing only its SHA-256 hash.
- Every API request carries the token as a bearer credential and the API looks the session
  up: one indexed query that also returns the user and their membership.
- Auth.js provides the sign-in flow and keeps the token inside its encrypted, httpOnly
  session cookie. The token is never placed on the Auth.js `session` object, which browser
  code can read.
- Browser code reaches the API only through a Next.js route handler that attaches the
  token server-side.

## Consequences

- Sign-out, password change, deactivation and suspension take effect on the next request.
  There are no signing keys to rotate and no refresh flow to get wrong.
- Each request costs one session lookup. If that ever matters, it can be cached briefly.
- Script injected into a page could make requests while the page is open, but cannot read
  the token and carry the session away.
- Third-party API clients are out of scope for this mechanism. API keys or OAuth can be
  added beside it without changing it.
- Request bodies pass through the proxy in memory, capped at 10 MB. Node's `fetch` must be
  able to re-read a body when the API answers 401, which a streamed body does not allow.
  Large uploads will need their own path.
