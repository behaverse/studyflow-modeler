/**
 * Alignment snapping (parity spec §7 "Snap lines").
 *
 * While a shape is dragged, bpmn-js pulls it into line with the elements around it
 * — centre to centre, edge to edge — and paints a faint blue guide along the
 * alignment it took. That guide is the ONLY thing the snap lines ever mean: they are
 * not a grid overlay, and a diagram with nothing to align against shows none.
 *
 * This module is the pure geometry half: collect the coordinates worth snapping to,
 * then answer "what does this coordinate become, and along which line". Who feeds it
 * (a move, a resize, a bendpoint drag) and who draws the guides is `Canvas.ts`.
 *
 * The tolerance is diagram-js's own `SNAP_TOLERANCE` of 7 units.
 */

import { isHiddenByCollapse } from '@canvas/model/expand.ts';
import type { Bounds, Point, Scene, SceneNode } from '@canvas/model/scene.ts';

/** How near an alignment has to be before a gesture is pulled onto it. */
export const SNAP_TOLERANCE = 7;

/** Coordinates a gesture may be pulled onto, split by axis. */
export interface SnapTargets {
  xs: number[];
  ys: number[];
}

/**
 * Which coordinates of a neighbouring shape are worth aligning to:
 *
 * - `'mid'` — its centre only, which is what a MOVE aligns against (a task dropped
 *   level with the start event before it);
 * - `'bounds'` — its centre and its four edges, which is what a RESIZE or a bendpoint
 *   drag wants (an edge dragged flush with the shape beside it).
 */
export type SnapKind = 'mid' | 'bounds';

/**
 * The snap coordinates of every visible node of `scene` except the ids in `exclude`
 * (the elements the gesture is moving — a shape never snaps to itself).
 */
export function collectSnapTargets(
  scene: Scene,
  exclude: ReadonlySet<string>,
  kind: SnapKind = 'mid',
): SnapTargets {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const element of scene.elementsById.values()) {
    if (element.kind !== 'node' || exclude.has(element.id)) continue;
    if (isHiddenByCollapse(element)) continue;
    const node = element as SceneNode;
    xs.push(node.x + node.width / 2);
    ys.push(node.y + node.height / 2);
    if (kind === 'bounds') {
      xs.push(node.x, node.x + node.width);
      ys.push(node.y, node.y + node.height);
    }
  }
  return { xs, ys };
}

/**
 * The candidate nearest `value` within `tolerance`, or `undefined` when nothing is
 * close enough. Ties go to the last one seen, which keeps the choice stable as a
 * drag crosses a cluster of equally-aligned shapes.
 */
export function snapValue(
  value: number,
  candidates: readonly number[],
  tolerance = SNAP_TOLERANCE,
): number | undefined {
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

/** What a snap did to a point: where it landed, and the guides to draw for it. */
export interface SnapResult {
  point: Point;
  /** Diagram x of the vertical guide, when the x axis snapped. */
  guideX?: number;
  /** Diagram y of the horizontal guide, when the y axis snapped. */
  guideY?: number;
}

/**
 * Pull `point` onto the nearest target on each axis independently — one axis may
 * snap while the other runs free, which is exactly how a shape slides along a
 * neighbour's centre line.
 */
export function snapPoint(
  point: Point,
  targets: SnapTargets,
  tolerance = SNAP_TOLERANCE,
): SnapResult {
  const x = snapValue(point.x, targets.xs, tolerance);
  const y = snapValue(point.y, targets.ys, tolerance);
  return {
    point: { x: x ?? point.x, y: y ?? point.y },
    ...(x === undefined ? {} : { guideX: x }),
    ...(y === undefined ? {} : { guideY: y }),
  };
}

/**
 * Snap a MOVE: `bounds` is where the lead shape started, `dx`/`dy` the raw pointer
 * delta. The shape's CENTRE is what aligns, so the returned delta is the one that
 * puts that centre on a neighbour's, and the guides are drawn along it.
 */
export function snapMove(
  bounds: Bounds,
  dx: number,
  dy: number,
  targets: SnapTargets,
  tolerance = SNAP_TOLERANCE,
): { dx: number; dy: number; guideX?: number; guideY?: number } {
  const centre = {
    x: bounds.x + dx + bounds.width / 2,
    y: bounds.y + dy + bounds.height / 2,
  };
  const snapped = snapPoint(centre, targets, tolerance);
  return {
    dx: dx + (snapped.point.x - centre.x),
    dy: dy + (snapped.point.y - centre.y),
    ...(snapped.guideX === undefined ? {} : { guideX: snapped.guideX }),
    ...(snapped.guideY === undefined ? {} : { guideY: snapped.guideY }),
  };
}
