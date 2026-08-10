export const UNTAGGED = 'Other';

export function tagsOf(tags: string[] | undefined): string[] {
  const named = (tags ?? []).map((category) => category.trim()).filter(Boolean);
  return named.length > 0 ? [...new Set(named)] : [UNTAGGED];
}

export function primaryTagOf(tags: string[] | undefined): string {
  return tagsOf(tags)[0];
}

export function galleryTags(entries: Array<string[] | undefined>): string[] {
  const present = [...new Set(entries.flatMap(tagsOf))];
  return present
    .filter((category) => category !== UNTAGGED)
    .sort((a, b) => a.localeCompare(b))
    .concat(present.includes(UNTAGGED) ? [UNTAGGED] : []);
}

export function hasTag(tags: string[] | undefined, shelf: string): boolean {
  return tagsOf(tags).includes(shelf);
}

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
