/**
 * Folding #3 — inline diagram geometry attaches to the element it describes.
 *
 * A shape's `bounds`/`label`/DI flags (and an edge's `waypoint`) normally live
 * in a `bpmndi:BPMNShape`/`bpmndi:BPMNEdge` under the plane's `planeElement`.
 * This folding lifts that payload onto the semantic element's own node, so a
 * `flowElement` carries its own `bounds`. The DI element's id is dropped on
 * FOLD and regenerated as `<elementId>_di` on UNFOLD.
 *
 * The shared invariant is {@link diTypeFor}: `bounds` present (and not a
 * property of the element's own descriptor) means a shape, `waypoint` means an
 * edge. Both directions consult it — serialize to know a shape's payload is
 * foldable, deserialize to know which DI type to rebuild — so they agree on the
 * shape/edge discrimination.
 */

/** DI reference properties point at other DI elements whose ids are regenerated on load. */
const UNFOLDABLE_DI_KEYS = new Set(['sourceElement', 'targetElement', 'choreographyActivityShape']);

export type DiType = 'bpmndi:BPMNShape' | 'bpmndi:BPMNEdge';

/**
 * Shared FOLD/UNFOLD discriminator: which DI type an inline geometry payload
 * belongs to, given the keys present on a node and the element's own descriptor.
 * `bounds` marks a shape, `waypoint` an edge; a key that the element's own
 * descriptor already declares is not a folded-DI marker.
 */
export function diTypeFor(keys: { has: (key: string) => boolean }, ownByName: Record<string, any>): DiType | undefined {
  if (keys.has('bounds') && !ownByName['bounds']) return 'bpmndi:BPMNShape';
  if (keys.has('waypoint') && !ownByName['waypoint']) return 'bpmndi:BPMNEdge';
  return undefined;
}

/**
 * FOLD (serialize): the foldable payload of a `planeElement` — its serialized
 * node minus the id (regenerated on load) and `bpmnElement` (implied by the host
 * element). Returns undefined when the planeElement cannot be folded: not a
 * shape/edge, carries raw attributes, or references another DI element by an id
 * that would not survive regeneration.
 */
export function foldablePayload(
  pe: any,
  serializeElement: (el: any, declaredType: string) => Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (pe.$type !== 'bpmndi:BPMNShape' && pe.$type !== 'bpmndi:BPMNEdge') return undefined;
  if (Object.keys(pe.$attrs ?? {}).length > 0) return undefined; // unclassifiable on load
  const node = serializeElement(pe, pe.$type);
  delete node.id; // regenerated as `<elementId>_di` on load
  delete node.bpmnElement;
  for (const key of Object.keys(node)) if (UNFOLDABLE_DI_KEYS.has(key)) return undefined;
  return node;
}

/**
 * FOLD (serialize): map semantic element ids to the foldable DI payload of their
 * planeElement, for the primary diagram only. An element with two planeElements
 * is ambiguous and folds nothing (both stay under `diagram:`).
 */
export function planDiFolding(
  definitions: any,
  serializeElement: (el: any, declaredType: string) => Record<string, unknown>,
): Map<string, Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  const seen = new Set<string>();
  for (const pe of definitions.diagrams?.[0]?.plane?.planeElement ?? []) {
    const refId = pe?.bpmnElement?.id;
    if (typeof refId !== 'string' || refId === '') continue;
    if (seen.has(refId)) {
      byId.delete(refId); // two planeElements for one element: ambiguous, keep both in `diagram:`
      continue;
    }
    seen.add(refId);
    const payload = foldablePayload(pe, serializeElement);
    if (payload) byId.set(refId, payload);
  }
  return byId;
}

/**
 * UNFOLD (deserialize): split inline diagram geometry off a semantic element's
 * node. Mutates `props` in place, removing the DI keys, and returns the DI type
 * and extracted props — or undefined when the node carries no folded geometry.
 *
 * `bounds`/`waypoint` mark the type; the remaining keys move along only when
 * they belong to the DI descriptor and not the element's own (colors, label, DI
 * flags). `ownByName` is the element descriptor's `propertiesByName`;
 * `diByName` resolves the DI type's `propertiesByName`.
 */
export function extractInlineDi(
  props: Record<string, any>,
  ownByName: Record<string, any>,
  diPropertiesByName: (type: DiType) => Record<string, any>,
): { type: DiType; props: Record<string, unknown> } | undefined {
  const keys = { has: (key: string) => key in props };
  const diType = diTypeFor(keys, ownByName);
  if (!diType) return undefined;

  const diByName = diPropertiesByName(diType);
  const diProps: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === 'id' || ownByName[key] || !diByName[key]) continue;
    diProps[key] = props[key];
    delete props[key];
  }
  return { type: diType, props: diProps };
}
