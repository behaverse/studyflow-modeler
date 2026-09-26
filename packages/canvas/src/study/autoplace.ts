/** Where a click-append lands: one gap to the right of the source, nudged down until free. */

import { BPMN } from '@core/constants.ts';
import { centerOf } from '@core/document/outline.ts';

import { edgesIntersecting, isContainerNode, nodesIntersecting, pointInBox } from '@canvas/study/hit.ts';
import type { Bounds, Point, Scene, SceneEdge, SceneNode } from '@canvas/study/scene.ts';
import { routableEnd } from '@canvas/study/orthogonal.ts';
import { planeOf } from '@canvas/study/tree.ts';

export const APPEND_DISTANCE = 50;
const ANNOTATION_APPEND_DISTANCE = 50;
const APPEND_NUDGE = 100;
const MAX_PROBES = 200;

/** The centre a shape of `size` appended from `source` takes; an annotation hangs above. */
function appendPosition(source: Bounds, size: { width: number; height: number }, type?: string): Point {
  if (type === BPMN.TextAnnotation) {
    return {
      x: source.x + source.width + size.width / 2,
      y: source.y - ANNOTATION_APPEND_DISTANCE - size.height / 2,
    };
  }
  return { x: source.x + source.width + APPEND_DISTANCE + size.width / 2, y: source.y + source.height / 2 };
}

/** A connection appends from the middle of its path. */
export function appendSourceBounds(source: SceneNode | SceneEdge): Bounds {
  return routableEnd(source);
}

function verticalEscape(source: Bounds, size: { width: number; height: number }): number {
  return source.width / 2 + APPEND_DISTANCE + size.width / 2 + 1;
}

/** The first free centre for `size` appended from `source`; the hover ghost and the click agree on it. */
export function freeAppendPosition(
  source: Bounds,
  size: { width: number; height: number },
  type: string | undefined,
  isOccupied: (bounds: Bounds) => boolean,
): Point {
  const start = appendPosition(source, size, type);
  const up = type === BPMN.TextAnnotation;
  const step = up ? -APPEND_NUDGE : APPEND_NUDGE;
  const first = up ? -APPEND_NUDGE : Math.max(APPEND_NUDGE, verticalEscape(source, size));
  for (let probe = 0; probe < MAX_PROBES; probe += 1) {
    const offset = probe === 0 ? 0 : first + (probe - 1) * step;
    const at = { x: start.x, y: start.y + offset };
    const bounds = { x: at.x - size.width / 2, y: at.y - size.height / 2, width: size.width, height: size.height };
    if (!isOccupied(bounds)) return at;
  }
  return start;
}

/**
 * Whether a shape at `bounds` would land on a shape or across a flow of the plane `from` is drawn on (the view that
 * shows `from` shows that plane): a container counts only when `from` sits outside it.
 */
export function isAreaOccupied(scene: Scene, bounds: Bounds, from: SceneNode | SceneEdge): boolean {
  const plane = planeOf(from);
  const origin = centerOf(appendSourceBounds(from));
  const onNode = nodesIntersecting(scene, bounds, plane).some((node) => {
    if (node === from) return false;
    if (!isContainerNode(node)) return true;
    return !pointInBox(origin, node);
  });
  if (onNode) return true;
  return edgesIntersecting(scene, bounds, plane).some((edge) => edge !== from);
}

/** The first free centre for `size` appended from `source`, clear of what shares its plane. */
export function appendSpot(scene: Scene, source: SceneNode | SceneEdge, size: { width: number; height: number }, type: string): Point {
  return freeAppendPosition(appendSourceBounds(source), size, type, (bounds) => isAreaOccupied(scene, bounds, source));
}

/** Where a shape added without a place goes: beside the rightmost shape in `container`, else near its top-left. */
export function freeSpot(scene: Scene, container: SceneNode | undefined, size: { width: number; height: number }, type: string): Point {
  const siblings = container ? container.children : scene.children;
  const rightmost = siblings
    .filter((element): element is SceneNode => element.kind === 'node')
    .reduce<SceneNode | undefined>((far, node) => (!far || node.x + node.width > far.x + far.width ? node : far), undefined);
  if (rightmost) return appendSpot(scene, rightmost, size, type);
  const corner = container ? { x: container.x + APPEND_DISTANCE, y: container.y + APPEND_DISTANCE } : { x: 100, y: 100 };
  return { x: corner.x + size.width / 2, y: corner.y + size.height / 2 };
}
