/**
 * Pure shape geometry (design §3 `render/shapes.ts`, §2 vocabulary) — every base
 * silhouette the canvas draws from scratch, ported/adapted from the modeler's
 * `draw/` (which delegated to bpmn-js handlers) and `draw/choreographyLayout.ts`.
 *
 * Each drawer appends its primitives to `parent` in the element's *local* frame
 * (origin `0,0`, extent `width × height`); the renderer wraps the group in a
 * `translate(x, y)` so these functions never need absolute coordinates. They are
 * side-effecting only on `parent` and return the primary outline element.
 *
 * No DOM globals beyond {@link svg} helpers; no bpmn-js / diagram-js.
 */

import { append, create } from '@canvas/render/svg.ts';

/** Stroke/fill styling resolved by the renderer from the element's DI colors. */
export interface ShapeStyle {
  stroke: string;
  fill: string;
  strokeWidth?: number;
  /** Dash pattern for groups / message flows / associations. */
  dashArray?: string;
}

/** bpmn-js task/subprocess corner radius; also the choreography band corner. */
export const CORNER_RADIUS = 10;

const DEFAULT_STROKE_WIDTH = 2;

function withDefaults(style: ShapeStyle): Required<Omit<ShapeStyle, 'dashArray'>> & { dashArray?: string } {
  return {
    stroke: style.stroke,
    fill: style.fill,
    strokeWidth: style.strokeWidth ?? DEFAULT_STROKE_WIDTH,
    dashArray: style.dashArray,
  };
}

// ---------------------------------------------------------------------------
// Events — circle 36×36 (design §2).
// ---------------------------------------------------------------------------

/** Kinds of event ring; drives stroke weight and inner rings. */
export type EventKind = 'start' | 'end' | 'intermediateThrow' | 'intermediateCatch' | 'boundary';

/** Draw an event circle. End is a thick ring; intermediate/boundary get a double ring. */
export function drawEvent(parent: SVGElement, w: number, h: number, style: ShapeStyle, kind: EventKind): SVGElement {
  const s = withDefaults(style);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.max(0, Math.min(w, h) / 2 - 1);

  const strokeWidth = kind === 'end' ? 4 : kind === 'boundary' ? 1.5 : s.strokeWidth;
  const outer = create('circle', {
    cx, cy, r,
    fill: s.fill,
    stroke: s.stroke,
    'stroke-width': strokeWidth,
    'stroke-dasharray': kind === 'boundary' ? '6,4' : null,
  });
  append(parent, outer);

  if (kind === 'intermediateThrow' || kind === 'intermediateCatch' || kind === 'boundary') {
    append(parent, create('circle', {
      cx, cy, r: Math.max(0, r - 3),
      fill: 'none',
      stroke: s.stroke,
      'stroke-width': 1.5,
      'stroke-dasharray': kind === 'boundary' ? '6,4' : null,
    }));
  }
  return outer;
}

// ---------------------------------------------------------------------------
// Activities — rounded rect 100×80 r10 (design §2).
// ---------------------------------------------------------------------------

/** Draw a task/subprocess/call-activity rounded rectangle. `thick` for call activity. */
export function drawTask(parent: SVGElement, w: number, h: number, style: ShapeStyle, thick = false): SVGElement {
  const s = withDefaults(style);
  const rect = create('rect', {
    x: 0, y: 0, width: w, height: h,
    rx: CORNER_RADIUS, ry: CORNER_RADIUS,
    fill: s.fill,
    stroke: s.stroke,
    'stroke-width': thick ? 4 : s.strokeWidth,
  });
  append(parent, rect);
  return rect;
}

// ---------------------------------------------------------------------------
// Gateways — diamond 50×50 (ported from draw/Renderer.drawDiamond).
// ---------------------------------------------------------------------------

/** Draw a gateway diamond. */
export function drawDiamond(parent: SVGElement, w: number, h: number, style: ShapeStyle): SVGElement {
  const s = withDefaults(style);
  const cx = w / 2;
  const cy = h / 2;
  const points = `${cx},0 ${w},${cy} ${cx},${h} 0,${cy}`;
  const polygon = create('polygon', {
    points,
    fill: s.fill,
    stroke: s.stroke,
    'stroke-width': s.strokeWidth,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
  append(parent, polygon);
  return polygon;
}

// ---------------------------------------------------------------------------
// Data — dog-eared page and cylinder (design §2).
// ---------------------------------------------------------------------------

/** Draw a data object as a dog-eared page. */
export function drawDataObject(parent: SVGElement, w: number, h: number, style: ShapeStyle): SVGElement {
  const s = withDefaults(style);
  const fold = Math.min(w, h) * 0.32;
  const body = create('path', {
    d: `M0,0 L${w - fold},0 L${w},${fold} L${w},${h} L0,${h} Z`,
    fill: s.fill,
    stroke: s.stroke,
    'stroke-width': s.strokeWidth,
    'stroke-linejoin': 'round',
  });
  append(parent, body);
  append(parent, create('path', {
    d: `M${w - fold},0 L${w - fold},${fold} L${w},${fold}`,
    fill: 'none',
    stroke: s.stroke,
    'stroke-width': s.strokeWidth,
    'stroke-linejoin': 'round',
  }));
  return body;
}

/** Draw a data store as a cylinder. */
export function drawDataStore(parent: SVGElement, w: number, h: number, style: ShapeStyle): SVGElement {
  const s = withDefaults(style);
  const rx = w / 2;
  const ry = Math.min(h * 0.12, 8);
  const body = create('path', {
    d: `M0,${ry} `
      + `A${rx},${ry} 0 0 0 ${w},${ry} `
      + `L${w},${h - ry} `
      + `A${rx},${ry} 0 0 1 0,${h - ry} `
      + `Z`,
    fill: s.fill,
    stroke: s.stroke,
    'stroke-width': s.strokeWidth,
    'stroke-linejoin': 'round',
  });
  append(parent, body);
  // Top rim, drawn as a full ellipse so the lid reads correctly.
  append(parent, create('path', {
    d: `M0,${ry} A${rx},${ry} 0 0 0 ${w},${ry} A${rx},${ry} 0 0 0 0,${ry} Z`,
    fill: 'none',
    stroke: s.stroke,
    'stroke-width': s.strokeWidth,
  }));
  return body;
}

// ---------------------------------------------------------------------------
// Artifacts / containers — group, text annotation, participant/lane.
// ---------------------------------------------------------------------------

/** Draw a group as a dashed rounded rect. */
export function drawGroup(parent: SVGElement, w: number, h: number, style: ShapeStyle): SVGElement {
  const s = withDefaults(style);
  const rect = create('rect', {
    x: 0, y: 0, width: w, height: h,
    rx: CORNER_RADIUS, ry: CORNER_RADIUS,
    fill: 'none',
    stroke: s.stroke,
    'stroke-width': s.strokeWidth,
    'stroke-dasharray': s.dashArray ?? '10,6,0,6',
  });
  append(parent, rect);
  return rect;
}

/** Draw a text annotation as a left bracket. */
export function drawTextAnnotation(parent: SVGElement, w: number, h: number, style: ShapeStyle): SVGElement {
  const s = withDefaults(style);
  const arm = Math.min(w * 0.4, 10);
  const bracket = create('path', {
    d: `M${arm},0 L0,0 L0,${h} L${arm},${h}`,
    fill: 'none',
    stroke: s.stroke,
    'stroke-width': s.strokeWidth,
    'stroke-linejoin': 'round',
  });
  append(parent, bracket);
  return bracket;
}

/** Draw a participant pool or lane: outer rect with a left title band divider. */
export function drawParticipant(parent: SVGElement, w: number, h: number, style: ShapeStyle): SVGElement {
  const s = withDefaults(style);
  const rect = create('rect', {
    x: 0, y: 0, width: w, height: h,
    fill: s.fill,
    stroke: s.stroke,
    'stroke-width': s.strokeWidth,
  });
  append(parent, rect);
  const band = Math.min(30, w);
  append(parent, create('line', {
    x1: band, y1: 0, x2: band, y2: h,
    stroke: s.stroke,
    'stroke-width': s.strokeWidth,
  }));
  return rect;
}

// ---------------------------------------------------------------------------
// Choreography — bands (ported verbatim from draw/choreographyLayout.ts).
// ---------------------------------------------------------------------------

const CHOREOGRAPHY_BAND_HEIGHT = 20;

/** Path for the top/bottom participant band of a choreography task (ported). */
export function bandPath(width: number, bandHeight: number, height: number, edge: 'top' | 'bottom'): string {
  const r = CORNER_RADIUS;
  if (edge === 'top') {
    return `M0,${bandHeight} L0,${r} Q0,0 ${r},0 L${width - r},0 Q${width},0 ${width},${r} L${width},${bandHeight} Z`;
  }
  const y = height - bandHeight;
  return `M0,${y} L${width},${y} L${width},${height - r} Q${width},${height} ${width - r},${height} L${r},${height} Q0,${height} 0,${height - r} Z`;
}

/** The (clamped) participant band height for a choreography task (ported). */
export function choreographyBandHeight(height: number): number {
  return Math.min(CHOREOGRAPHY_BAND_HEIGHT, Math.floor(height / 3));
}
