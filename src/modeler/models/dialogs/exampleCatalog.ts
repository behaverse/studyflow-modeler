/**
 * The gallery's shelves, derived from the diagrams on them.
 *
 * A study declares what kind of thing it is (`studyflow:tags` on its
 * root, see the `Classification` type in the core schema), so the filter chips
 * are whatever the shipped examples say they are — there is no list of
 * tags anywhere in the app to keep in step with the files. Order is
 * alphabetical for the same reason: any curated order would be a second source
 * of truth.
 *
 * A study may declare several, exactly as a schema property lists several
 * `meta.tags`; its card then appears under each.
 */

/** Shelf for a diagram that declares no category. */
export const UNTAGGED = 'Other';

/** The shelves a diagram sits on; every diagram sits on at least one. */
export function tagsOf(tags: string[] | undefined): string[] {
  const named = (tags ?? []).map((category) => category.trim()).filter(Boolean);
  return named.length > 0 ? [...new Set(named)] : [UNTAGGED];
}

/** The shelf a card files under when the grid is sorted or unfiltered. */
export function primaryTagOf(tags: string[] | undefined): string {
  return tagsOf(tags)[0];
}

/** Distinct tags across the gallery, alphabetical, with `Other` last. */
export function galleryTags(entries: Array<string[] | undefined>): string[] {
  const present = [...new Set(entries.flatMap(tagsOf))];
  return present
    .filter((category) => category !== UNTAGGED)
    .sort((a, b) => a.localeCompare(b))
    .concat(present.includes(UNTAGGED) ? [UNTAGGED] : []);
}

/** True when a card belongs on `shelf`. */
export function hasTag(tags: string[] | undefined, shelf: string): boolean {
  return tagsOf(tags).includes(shelf);
}

/** Card order: by shelf, then by title — so the grid reads as its tags
 *  even with the "All" chip selected. */
export function compareExamples(
  a: { tags: string[]; title: string },
  b: { tags: string[]; title: string },
): number {
  const shelfA = primaryTagOf(a.tags);
  const shelfB = primaryTagOf(b.tags);
  if (shelfA === shelfB) return a.title.localeCompare(b.title);
  if (shelfA === UNTAGGED) return 1;
  if (shelfB === UNTAGGED) return -1;
  return shelfA.localeCompare(shelfB);
}
