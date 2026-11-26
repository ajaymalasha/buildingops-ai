/**
 * Ticking rows of a list to act on several at once.
 *
 * What is ticked is a set of row keys, and these functions never change the set they are
 * given: each returns a new one, as React state has to be replaced rather than altered.
 */

/** The set with `key` ticked if it was not, and unticked if it was. */
export function toggleOne(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** How much of `keys` is ticked: what the box that stands for all of them shows. */
export function selectionState(
  selected: ReadonlySet<string>,
  keys: readonly string[],
): "none" | "some" | "all" {
  const ticked = keys.filter((key) => selected.has(key)).length;
  if (ticked === 0) return "none";
  return ticked === keys.length ? "all" : "some";
}

/**
 * The set after the box that stands for all of `keys` is pressed: every one of them
 * ticked, or, if they all were already, none of them. Anything else that was ticked stays.
 */
export function toggleAll(selected: ReadonlySet<string>, keys: readonly string[]): Set<string> {
  const next = new Set(selected);
  const untick = selectionState(selected, keys) === "all";
  for (const key of keys) {
    if (untick) next.delete(key);
    else next.add(key);
  }
  return next;
}

/**
 * What is still ticked once the list has changed: only keys that are among `keys` now. A
 * row that left the page, or can no longer be acted on, must not be acted on unseen.
 */
export function keepSelected(selected: ReadonlySet<string>, keys: readonly string[]): string[] {
  return keys.filter((key) => selected.has(key));
}
