/**
 * Leave the current document and load `path` from the server.
 *
 * Client-side navigation keeps in-memory state alive: the query cache, and the state of
 * routes the framework preserves in the background. That is wrong once the meaning of the
 * session has changed, as it has after switching organization or when the API has ended
 * the session. A full load guarantees nothing from before survives.
 */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}
