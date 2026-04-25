// Pure path helpers for token simulation along polylines.

export type Point = { x: number; y: number };

/**
 * Smoother interpolation: maps 0->1 to 0->1 with zero first AND
 * second derivatives at endpoints (Ken Perlin's smootherstep).
 */
export function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Compute the length of each segment of a polyline,
 * along with the total polyline distance.
 */
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

/**
 * Sample a position along a polyline at a given distance from the start.
 * If `dist` exceeds the polyline length, returns the last point.
 */
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
  // past the end; return last point
  return points[points.length - 1];
}
