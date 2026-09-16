/**
 * Auto-layout routes each edge on its own, so edges through one corridor land on one line and read
 * as one edge. This pass slides such collinear runs apart, a few pixels each, and pulls a docking
 * point it moved back onto its shape's outline.
 */

import { cropWaypoints, type CroppableShape, type Point } from '@canvas/index.ts';

export interface SpreadEdge {
  waypoints: readonly Point[];
  source?: CroppableShape;
  target?: CroppableShape;
}

/** How far apart two runs sharing a line end up. */
export const SPREAD = 10;

interface Run {
  edge: number;
  /** Index of the run's first waypoint; the run ends at the next one. */
  at: number;
  lo: number;
  hi: number;
  /** Where the perpendicular neighbour at each end heads: -1 above/left, 1 below/right, 0 for none. */
  loTurn: number;
  hiTurn: number;
  /** The turns at the ends lying strictly inside the group's extent, summed: which side clears them. */
  side: number;
}

export function spreadEdges(edges: readonly SpreadEdge[]): Point[][] {
  const paths = edges.map((edge) => simplify(edge.waypoints));
  const before = paths.map((path) => path.map((p) => ({ ...p })));
  // Horizontal runs first: a vertical run's extent, which decides its place, ends where its horizontal feed now lies.
  for (const axis of ['y', 'x'] as const) {
    for (const group of runGroups(paths, axis)) {
      group.sort((p, q) => p.side - q.side || sideward(q) - sideward(p) || p.edge - q.edge || p.at - q.at);
      group.forEach((run, i) => {
        const offset = (i - (group.length - 1) / 2) * SPREAD;
        paths[run.edge][run.at][axis] += offset;
        paths[run.edge][run.at + 1][axis] += offset;
      });
    }
  }
  return paths.map((path, i) => {
    const moved = (at: number): boolean => path[at].x !== before[i][at].x || path[at].y !== before[i][at].y;
    return cropWaypoints(path, moved(0) ? edges[i].source : undefined, moved(path.length - 1) ? edges[i].target : undefined);
  });
}

/** The runs along `axis` lines (a horizontal run lies on a `y` line), in groups of two or more on top of each other. */
function runGroups(paths: Point[][], axis: 'x' | 'y'): Run[][] {
  const along = axis === 'y' ? 'x' : 'y';
  const byLine = new Map<number, Run[]>();
  paths.forEach((path, edge) => {
    for (let at = 0; at < path.length - 1; at += 1) {
      const [a, b] = [path[at], path[at + 1]];
      if (Math.abs(a[axis] - b[axis]) >= 0.5) continue;
      const [lo, hi] = a[along] <= b[along] ? [a, b] : [b, a];
      const turnAt = (end: Point, next: Point | undefined): number => (next ? Math.sign(next[axis] - end[axis]) : 0);
      const run: Run = {
        edge, at, lo: lo[along], hi: hi[along], side: 0,
        loTurn: turnAt(lo, lo === a ? path[at - 1] : path[at + 2]),
        hiTurn: turnAt(hi, hi === a ? path[at - 1] : path[at + 2]),
      };
      byLine.set(Math.round(a[axis]), [...(byLine.get(Math.round(a[axis])) ?? []), run]);
    }
  });
  const groups: Run[][] = [];
  for (const runs of byLine.values()) {
    // Chains of pairwise overlap; a run touching another end to end is not on top of it.
    let reach = -Infinity;
    for (const run of runs.sort((p, q) => p.lo - q.lo)) {
      if (run.lo < reach - 0.5) groups[groups.length - 1].push(run);
      else groups.push([run]);
      reach = Math.max(reach, run.hi);
    }
  }
  for (const group of groups) {
    const lo = Math.min(...group.map((run) => run.lo));
    const hi = Math.max(...group.map((run) => run.hi));
    for (const run of group) run.side = (run.lo > lo + 0.5 ? run.loTurn : 0) + (run.hi < hi - 0.5 ? run.hiTurn : 0);
  }
  return groups.filter((group) => group.length > 1);
}

/** Within a side, the shorter (inner) run sits nearest it, so its turns clear the runs it lies within. */
function sideward(run: Run): number {
  return Math.sign(run.side) * (run.hi - run.lo);
}

/** Without repeated points and collinear middles: bpmn-auto-layout emits both, and a run must be one segment. */
function simplify(waypoints: readonly Point[]): Point[] {
  const points: Point[] = [];
  for (const p of waypoints) {
    const prev = points[points.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 0.5) continue;
    const before = points[points.length - 2];
    if (before && Math.abs((prev.x - before.x) * (p.y - before.y) - (prev.y - before.y) * (p.x - before.x)) < 0.5) points.pop();
    points.push({ x: p.x, y: p.y });
  }
  return points;
}
