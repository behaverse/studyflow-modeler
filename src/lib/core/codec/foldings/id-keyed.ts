/**
 * Folding #4 — id-keyed containment.
 *
 * A containment list whose items all carry unique ids folds into an
 * `id -> body` mapping (`flowElements`, `participants`, `lanes`, ...), so the
 * `id` field becomes the YAML key. Lists with any id-less item (extension
 * wrappers, waypoints) stay plain lists.
 *
 * The FOLD ({@link keyItemsById}) and UNFOLD ({@link keyedMapToList}) are exact
 * inverses of each other, so the round-trip invariant is captured by this pair
 * being co-located.
 */

/**
 * FOLD (serialize): a containment list whose items all carry unique ids folds
 * into an `id -> body` mapping. Returns undefined (keep the list) when any item
 * is id-less, has a non-string/empty id, or repeats an id already seen.
 */
export function keyItemsById(items: unknown[]): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const { id, ...body } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || id in out) return undefined;
    out[id] = body;
  }
  return out;
}

/** UNFOLD (deserialize): an `id -> body` mapping back to a plain containment list. */
export function keyedMapToList(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>).map(([id, body]) =>
    body && typeof body === 'object' && !Array.isArray(body) ? { id, ...(body as object) } : { id },
  );
}
