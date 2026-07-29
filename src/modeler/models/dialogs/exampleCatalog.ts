/**
 * The gallery's shelves, derived from the diagrams on them.
 *
 * A study declares what kind of thing it is (`studyflow:categories` on its
 * root, see the `Classification` type in the core schema), so the filter chips
 * are whatever the shipped examples say they are — there is no list of
 * categories anywhere in the app to keep in step with the files. Order is
 * alphabetical for the same reason: any curated order would be a second source
 * of truth.
 *
 * A study may declare several, exactly as a schema property lists several
 * `meta.categories`; its card then appears under each.
 */

/** Shelf for a diagram that declares no category. */
export const UNCATEGORIZED = 'Other';

/** The shelves a diagram sits on; every diagram sits on at least one. */
export function categoriesOf(categories: string[] | undefined): string[] {
  const named = (categories ?? []).map((category) => category.trim()).filter(Boolean);
  return named.length > 0 ? [...new Set(named)] : [UNCATEGORIZED];
}

/** The shelf a card files under when the grid is sorted or unfiltered. */
export function primaryCategoryOf(categories: string[] | undefined): string {
  return categoriesOf(categories)[0];
}

/** Distinct categories across the gallery, alphabetical, with `Other` last. */
export function galleryCategories(entries: Array<string[] | undefined>): string[] {
  const present = [...new Set(entries.flatMap(categoriesOf))];
  return present
    .filter((category) => category !== UNCATEGORIZED)
    .sort((a, b) => a.localeCompare(b))
    .concat(present.includes(UNCATEGORIZED) ? [UNCATEGORIZED] : []);
}

/** True when a card belongs on `shelf`. */
export function isInCategory(categories: string[] | undefined, shelf: string): boolean {
  return categoriesOf(categories).includes(shelf);
}

/** Card order: by shelf, then by title — so the grid reads as its categories
 *  even with the "All" chip selected. */
export function compareExamples(
  a: { categories: string[]; title: string },
  b: { categories: string[]; title: string },
): number {
  const shelfA = primaryCategoryOf(a.categories);
  const shelfB = primaryCategoryOf(b.categories);
  if (shelfA === shelfB) return a.title.localeCompare(b.title);
  if (shelfA === UNCATEGORIZED) return 1;
  if (shelfB === UNCATEGORIZED) return -1;
  return shelfA.localeCompare(shelfB);
}
