import type { SchemaCategoryModel } from '@/core/schema';
import type { CategoryEntry } from '@/core/catalog/types';

/**
 * Inspector tabs, as the schemas declare them.
 *
 * An attribute joins a tab by naming it in `meta.categories`; the schema that
 * owns the tab declares where it sits with a top-level `categories:` block.
 * Nothing in the app keeps a list of tab names — a schema adding a category
 * places it itself, and one that names a category without declaring it simply
 * lands after every declared tab.
 */

/** Categories no schema declares, so they sort after every declared one. */
export const UNDECLARED_CATEGORY_ORDER = Number.MAX_SAFE_INTEGER;

export function compileCategories(raw: unknown): CategoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is SchemaCategoryModel => !!entry && typeof entry.name === 'string')
    .map((entry, index) => ({
      name: entry.name,
      // A block with no explicit orders still reads top-to-bottom.
      order: typeof entry.order === 'number' ? entry.order : index,
      description: entry.description,
      synthetic: entry.synthetic === true,
    }));
}
