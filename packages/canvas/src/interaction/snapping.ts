/** Alignment snapping: pull a gesture onto a neighbour's centre or edge, and say where the guide goes. */

import type { Bounds, Point, Scene } from '@canvas/model/scene.ts';
import { isHidden } from '@canvas/model/tree.ts';

export const SNAP_TOLERANCE = 7;

export interface SnapTargets {
  xs: number[];
  ys: number[];
}

/** `'mid'`: centres only (a move). `'bounds'`: centres and edges (a resize, a bendpoint). */
export type SnapKind = 'mid' | 'bounds';

export function collectSnapTargets(scene: Scene, exclude: ReadonlySet<string>, kind: SnapKind = 'mid'): SnapTargets {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const node of scene.elementsById.values()) {
    if (node.kind !== 'node' || exclude.has(node.id) || isHidden(node, scene.scope)) continue;
    xs.push(node.x + node.width / 2);
    ys.push(node.y + node.height / 2);
    if (kind === 'bounds') {
      xs.push(node.x, node.x + node.width);
      ys.push(node.y, node.y + node.height);
    }
  }
  return { xs, ys };
}

export function snapValue(value: number, candidates: readonly number[], tolerance = SNAP_TOLERANCE): number | undefined {
  let best: number | undefined;
  let bestDistance = tolerance;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

export interface SnapResult {
  point: Point;
  guideX?: number;
  guideY?: number;
}

export function snapPoint(point: Point, targets: SnapTargets, tolerance = SNAP_TOLERANCE): SnapResult {
  const x = snapValue(point.x, targets.xs, tolerance);
  const y = snapValue(point.y, targets.ys, tolerance);
  return {
    point: { x: x ?? point.x, y: y ?? point.y },
    ...(x === undefined ? {} : { guideX: x }),
    ...(y === undefined ? {} : { guideY: y }),
  };
}

/** Snap a move by its lead shape's centre. */
export function snapMove(
  bounds: Bounds,
  dx: number,
  dy: number,
  targets: SnapTargets,
  tolerance = SNAP_TOLERANCE,
): { dx: number; dy: number; guideX?: number; guideY?: number } {
  const centre = { x: bounds.x + dx + bounds.width / 2, y: bounds.y + dy + bounds.height / 2 };
  const snapped = snapPoint(centre, targets, tolerance);
  return {
    dx: dx + (snapped.point.x - centre.x),
    dy: dy + (snapped.point.y - centre.y),
    ...(snapped.guideX === undefined ? {} : { guideX: snapped.guideX }),
    ...(snapped.guideY === undefined ? {} : { guideY: snapped.guideY }),
  };
}
