# 0003. Web rendering: static shell, verified session, data in the browser

## Context

Next.js 16 offers Cache Components: every route gets a prerendered static shell and
request-dependent content streams in. Reading the session outside a Suspense boundary is a
build error in this model, and the framework documents it as the default from the next
major version. Almost everything in this app depends on who is signed in.

## Decision

- Cache Components is enabled. The authenticated layout is static; inside one Suspense
  boundary a server component verifies the session against the API and provides the user,
  organization and permissions to the rest of the tree.
- Pages are client components that fetch through TanStack Query and the generated API
  client. Server components do not fetch business data.
- After anything that changes what the session means (switching organization, the API
  ending the session) the app does a full page load rather than a client navigation.

## Consequences

- No migration is waiting when Cache Components becomes mandatory.
- Navigation between pages is instant and needs no server render.
- The first paint of a list shows a skeleton before data arrives. Server-side prefetch can
  be added per page where that matters.
- The framework keeps recently visited routes mounted but hidden. That is why an
  organization switch reloads the page: hidden routes would otherwise hold the previous
  organization's data.
