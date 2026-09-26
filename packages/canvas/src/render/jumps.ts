/**
 * Line jumps: where an edge crosses another, the flatter run hops over the steeper one with a
 * small semicircle, so a crossing never reads as a junction. Pure geometry; the renderer cuts the
 * arcs into the path.
 */

import type { Point } from '@canvas/model/scene.ts';

export const EDGE_CORNER_RADIUS = 6;
/** How far a jump reaches to either side of its crossing, along the segment. */
const JUMP_RADIUS = 5;

/** `[from, to]`: distances along a segment from its first waypoint that one jump arc spans. */
export type Span = readonly [number, number];

/**
 * The jump spans of each segment of `waypoints` (index `i` runs from waypoint `i` to `i + 1`). At a crossing the
 * flatter segment jumps; between two as flat, the edge drawn later does (`waypoints` over `below`, never over `above`).
 */
export function lineJumps(
  waypoints: readonly Point[], below: readonly (readonly Point[])[], above: readonly (readonly Point[])[],
): Span[][] {
  return waypoints.slice(0, -1).map((a, i) => segmentJumps(a, waypoints[i + 1], below, above));
}

function segmentJumps(a: Point, b: Point, below: readonly (readonly Point[])[], above: readonly (readonly Point[])[]): Span[] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const at: number[] = [];
  for (const [others, jumpsTies] of [[below, true], [above, false]] as const) {
    for (const other of others) {
      for (let j = 0; j < other.length - 1; j += 1) {
        const c = other[j];
        const d = other[j + 1];
        // Sign of |slope(cd)| - |slope(ab)|, cross-multiplied so a vertical has no infinite slope.
        const flatter = Math.abs(b.x - a.x) * Math.abs(d.y - c.y) - Math.abs(d.x - c.x) * Math.abs(b.y - a.y);
        if (flatter < 0 || (flatter === 0 && !jumpsTies)) continue;
        const t = crossingAt(a, b, c, d);
        if (t !== undefined) at.push(t * length);
      }
    }
  }
  // Crossings closer than a jump apart share one wider arc.
  const spans: [number, number][] = [];
  for (const distance of at.sort((p, q) => p - q)) {
    const last = spans[spans.length - 1];
    if (last && distance - JUMP_RADIUS <= last[1]) last[1] = distance + JUMP_RADIUS;
    else spans.push([distance - JUMP_RADIUS, distance + JUMP_RADIUS]);
  }
  // A jump keeps clear of the segment's ends, where a corner arc or an arrowhead already is.
  return spans.filter(([from, to]) => from >= EDGE_CORNER_RADIUS && to <= length - EDGE_CORNER_RADIUS);
}

/** Where `ab` crosses `cd` as a fraction of `ab`; `undefined` when they only touch at an end, or not at all. */
function crossingAt(a: Point, b: Point, c: Point, d: Point): number | undefined {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return undefined;
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  return t > 0 && t < 1 && u > 0 && u < 1 ? t : undefined;
}
