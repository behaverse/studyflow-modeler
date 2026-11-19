export const UNCATEGORIZED = 'Other';

export function categoryOf(category: string | undefined): string {
  return category?.trim() || UNCATEGORIZED;
}

export function galleryCategories(entries: Array<string | undefined>): string[] {
  const present = [...new Set(entries.map(categoryOf))];
  return present
    .filter((category) => category !== UNCATEGORIZED)
    .sort((a, b) => a.localeCompare(b))
    .concat(present.includes(UNCATEGORIZED) ? [UNCATEGORIZED] : []);
}

/** The first `count` examples with the featured ones leading, each group in the order given. */
export function leadingExamples<T extends { featured: boolean }>(entries: T[], count: number): T[] {
  return [...entries.filter((entry) => entry.featured), ...entries.filter((entry) => !entry.featured)].slice(0, count);
}

export function compareExamples(
  a: { category: string; title: string },
  b: { category: string; title: string },
): number {
  const shelfA = categoryOf(a.category);
  const shelfB = categoryOf(b.category);
  if (shelfA === shelfB) return a.title.localeCompare(b.title);
  if (shelfA === UNCATEGORIZED) return 1;
  if (shelfB === UNCATEGORIZED) return -1;
  return shelfA.localeCompare(shelfB);
}
