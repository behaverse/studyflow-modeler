import { getAttribute } from '@/core/extensions';
import type { AttributeSpec } from '@/core/catalog';

/** Whether an attribute definition renders in the inspector: hidden when
 *  pinned, otherwise gated by its `meta.condition` against the element's
 *  current attribute values. */
export function isAttributeVisible(attrDef: AttributeSpec | undefined, element: any): boolean {
  if (!attrDef || !element) return true;
  if (attrDef.meta?.pinned) return false;
  if (!attrDef.meta?.condition) return true;

  const conditions = attrDef.meta.condition.body || {};
  return Object.entries(conditions).every(([key, expected]) => {
    const actual = getAttribute(element, key);
    if (expected === '$set') return actual != null;
    if (Array.isArray(expected)) return expected.includes(actual);
    return actual === expected;
  });
}
