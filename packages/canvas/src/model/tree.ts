/**
 * Containment-tree helpers shared by everything that has to agree on z-order.
 *
 * {@link depthOf} is the single definition of "how deeply is this element nested":
 * the renderer paints ancestors first (`render/renderer.ts` `renderScene`), the
 * hit-test walks descendants first (`interaction/hit.ts`), and `Canvas.mount`
 * splices a newly created element in at the matching depth. Those three MUST derive
 * the same order — a container drawn after its children paints over them — so the
 * walk lives here once rather than being re-implemented per module.
 */

import type { SceneElement, SceneNode } from '@canvas/model/scene.ts';

/**
 * The z-order key of a drawable element inside the single `elements` layer
 * (`view/layers.ts`): `depth * 2`, plus one for a NODE.
 *
 * Two rules in one number. Shallower paints first, so a container sits behind
 * everything it contains — without which an expanded sub-process's opaque frame
 * covers its own interior flows. Within one depth the EDGES paint first, so a
 * sequence flow's arrowhead still passes under the shape it docks to, which is how
 * the diagram looked when connections had a layer of their own below the shapes.
 *
 * `render/renderer.ts` sorts by this on a full render and `Canvas.mount` splices a
 * newly created element in at the matching rank, so the two orders cannot drift.
 */
export function zRankOf(element: SceneElement): number {
  if (element.kind === 'edge') {
    // An edge crossing a container boundary (outside element → expanded
    // sub-process child) is parented at the common ancestor, but must paint
    // above every frame it enters — so it ranks at its DEEPEST endpoint, not
    // at its parent. For a same-depth edge the two are equal.
    const depth = Math.max(
      depthOf(element),
      element.source ? depthOf(element.source) : 0,
      element.target ? depthOf(element.target) : 0,
    );
    return depth * 2;
  }
  return depthOf(element) * 2 + 1;
}

/**
 * Containment depth of `element` (`0` at a plane root), guarded against a cyclic
 * `parent` chain so a malformed import cannot hang the render.
 */
export function depthOf(element: SceneElement | { parent?: SceneNode }): number {
  let depth = 0;
  let parent = element.parent;
  const guard = new Set<SceneNode>();
  while (parent && !guard.has(parent)) {
    guard.add(parent);
    depth += 1;
    parent = parent.parent;
  }
  return depth;
}
