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
