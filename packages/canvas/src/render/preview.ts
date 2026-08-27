/**
 * Preview edges — the transient line a gesture paints to promise a connection it has
 * not made yet.
 *
 * There are two of them and they look nothing alike. The context pad's hover ghost
 * ({@link Canvas.previewAppend}) draws the flow the rules WOULD mint, wearing its dash
 * and its arrowhead, and never changes once drawn. The connect/reconnect rubber band
 * (`interaction/connect.ts`) is repainted on every pointer frame and restyles itself
 * from the gesture's verdict — dashed while pending, solid and arrowheaded over an
 * accepted target, red over a refused one.
 *
 * What they share is the GEOMETRY contract, and it is not obvious enough to be worth
 * writing out twice: the path is drawn with ROUNDED bends (`roundedPathData` — the
 * same arcs the committed edge gets) while the raw waypoints are kept verbatim in
 * `data-waypoints`, because the arcs are cut out of the corners and the corner is
 * what a later reader — a spec, an export, the next gesture — needs back.
 *
 * They also share the degenerate case: a route of fewer than two points is not a
 * line, and neither caller wants an empty `<path>` for it.
 */

import type { Point } from '@canvas/model/scene.ts';
import { roundedPathData } from '@canvas/render/renderer.ts';
import { create } from '@canvas/render/svg.ts';

/** How a preview line is painted, over and above its geometry. */
export interface PreviewEdgeStyle {
  /** `stroke-dasharray`; `null`/omitted draws it solid. */
  dash?: string | null;
  /** `marker-end`; `null`/omitted draws it without an arrowhead. */
  markerEnd?: string | null;
  /** `stroke-width` in diagram units. Omitted leaves it to the stylesheet. */
  width?: number;
  /** `fill`. Omitted leaves it to the stylesheet. */
  fill?: string | null;
}

/**
 * The attributes a preview line carries: the rounded path through `points`, the
 * verbatim waypoint list, and `style`. `undefined` when `points` is not a line.
 */
export function previewEdgeAttrs(
  points: readonly Point[],
  style: PreviewEdgeStyle = {},
): Record<string, string | number | null | undefined> | undefined {
  if (points.length < 2) return undefined;
  return {
    d: roundedPathData(points),
    'data-waypoints': points.map((p) => `${p.x},${p.y}`).join(' '),
    fill: style.fill ?? null,
    'stroke-width': style.width ?? null,
    'stroke-dasharray': style.dash ?? null,
    'marker-end': style.markerEnd ?? null,
  };
}

/**
 * A fresh `<path class="cssClass">` previewing the edge through `points`, or
 * `undefined` when there is no line to draw.
 */
export function drawPreviewEdge(
  points: readonly Point[],
  cssClass: string,
  style: PreviewEdgeStyle = {},
): SVGElement | undefined {
  const attrs = previewEdgeAttrs(points, style);
  return attrs ? create('path', { class: cssClass, ...attrs }) : undefined;
}
