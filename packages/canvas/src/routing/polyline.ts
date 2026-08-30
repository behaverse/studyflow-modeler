/**
 * Polyline sampling — pure geometry over an edge's waypoints, shared by anything
 * that animates along a routed path (the token simulator, provenance replay).
 */

import type { Point } from '@canvas/model/scene.ts';

/** Perlin's smootherstep: zero first and second derivatives at both ends. */
export function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function computeSegLengths(points: Point[]): { segLengths: number[]; totalDist: number } {
  const segLengths: number[] = [];
  let totalDist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segLengths.push(len);
    totalDist += len;
  }
  return { segLengths, totalDist };
}

export function samplePolyline(points: Point[], segLengths: number[], dist: number): Point {
  let remaining = dist;
  for (let i = 0; i < segLengths.length; i++) {
    if (remaining <= segLengths[i]) {
      const t = segLengths[i] > 0 ? remaining / segLengths[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    remaining -= segLengths[i];
  }
  return points[points.length - 1];
}
