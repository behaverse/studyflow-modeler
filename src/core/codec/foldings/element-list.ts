/**
 * Folding #2 — list wrappers collapse to a plain list.
 *
 * A *list-wrapper* type has exactly one content property and that property is an
 * `isMany` list (`bpmn:ExtensionElements#values`). Such a wrapper serializes as
 * the plain list of its items — no `values:` key — and a plain list given for a
 * list-wrapper-typed property rebuilds back into the wrapper on load.
 *
 * The shared invariant is {@link elementListProperty}: "which single isMany
 * content property does this descriptor collapse into?". Both directions call
 * it so they agree on exactly which types fold. The serialize direction layers
 * instance-level guards on top (no raw attrs, no other set properties, non-empty
 * list) — those only make sense for a concrete element.
 */

/**
 * The single isMany content property a list-wrapper descriptor collapses into,
 * or undefined when the descriptor is not a list wrapper. Content properties are
 * the non-attribute, non-reference, non-body ones.
 */
export function elementListProperty(descriptor: any): any | undefined {
  const props: any[] = descriptor?.properties ?? [];
  const content = props.filter((p) => !p.isAttr && !p.isReference && !p.isBody);
  return content.length === 1 && content[0].isMany ? content[0] : undefined;
}

/**
 * FOLD (serialize): a list-wrapper element collapses to its items, mapped
 * through `serializeItem`. Returns undefined (keep the wrapper) when the element
 * is not a foldable list wrapper — it carries raw attributes, has any other
 * property set, or its list is empty.
 */
export function unwrapElementList(
  el: any,
  serializeItem: (item: any) => unknown,
): unknown[] | undefined {
  const content = elementListProperty(el.$descriptor);
  if (!content) return undefined;
  if (Object.keys(el.$attrs ?? {}).length > 0) return undefined;
  for (const p of el.$descriptor?.properties ?? []) {
    if (p === content) continue;
    if (el[p.name] !== undefined && el[p.name] !== null) return undefined;
  }
  const items = el[content.name];
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return items.map(serializeItem);
}
