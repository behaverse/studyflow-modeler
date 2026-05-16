export type Point = { x: number; y: number };

/** Ken Perlin's smootherstep: zero first and second derivatives at 0 and 1. */
export function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Length of each polyline segment plus the total length. */
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

/** Position at `dist` from the start of the polyline; clamps to the last point. */
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
