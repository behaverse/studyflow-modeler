/**
 * Shape silhouettes, drawn in the element's local frame (origin `0,0`). Each drawer
 * appends to `parent` and returns the primary outline element.
 */

import { BPMN } from '@core/constants.ts';

import { append, create } from '@canvas/render/svg.ts';
import { DATA_TYPES } from '@canvas/rules/rules.ts';

export type NodeCategory =
  | 'event' | 'task' | 'gateway' | 'data' | 'choreography' | 'group' | 'annotation' | 'participant' | 'unknown';

const EVENT_TYPES = new Set<string>([
  BPMN.StartEvent, BPMN.EndEvent, BPMN.IntermediateThrowEvent, BPMN.IntermediateCatchEvent, BPMN.BoundaryEvent,
]);
const TASK_TYPES = new Set<string>([
  BPMN.Task, BPMN.UserTask, BPMN.ServiceTask, BPMN.ScriptTask, BPMN.ManualTask, BPMN.SendTask, BPMN.ReceiveTask,
  BPMN.BusinessRuleTask, BPMN.CallActivity, BPMN.SubProcess, 'bpmn:AdHocSubProcess', 'bpmn:Transaction',
]);
const GATEWAY_TYPES = new Set<string>([
  BPMN.ExclusiveGateway, BPMN.ParallelGateway, BPMN.InclusiveGateway, BPMN.ComplexGateway, BPMN.EventBasedGateway,
]);

export function categoryOf(type: string): NodeCategory {
  if (type === BPMN.ChoreographyTask) return 'choreography';
  if (EVENT_TYPES.has(type)) return 'event';
  if (TASK_TYPES.has(type)) return 'task';
  if (GATEWAY_TYPES.has(type)) return 'gateway';
  if (DATA_TYPES.has(type)) return 'data';
  if (type === BPMN.Group) return 'group';
  if (type === BPMN.TextAnnotation) return 'annotation';
  if (type === BPMN.Participant || type === BPMN.Lane) return 'participant';
  return 'unknown';
}

export interface ShapeStyle {
  stroke: string;
  fill: string;
  strokeWidth?: number;
  dashArray?: string;
}

export const CORNER_RADIUS = 12;
export const STROKE_WIDTH = 1.5;

function widthOf(style: ShapeStyle): number {
  return style.strokeWidth ?? STROKE_WIDTH;
}

export type EventKind = 'start' | 'end' | 'intermediateThrow' | 'intermediateCatch' | 'boundary';

export function eventRadius(w: number, h: number): number {
  return Math.max(0, Math.round((w + h) / 4));
}

/** Start: a ring. End: a ring with a filled centre. Intermediate/boundary: a double ring. */
export function drawEvent(parent: SVGElement, w: number, h: number, style: ShapeStyle, kind: EventKind): SVGElement {
  const cx = w / 2;
  const cy = h / 2;
  const r = eventRadius(w, h);
  const dash = kind === 'boundary' ? '4,3' : null;
  // An end event is the same disc as a start event, drawn with a heavy ring.
  const ring = kind === 'end' ? widthOf(style) * 2.5 : widthOf(style);
  const outer = append(parent, create('circle', {
    cx, cy, r: kind === 'end' ? r - (ring - widthOf(style)) / 2 : r,
    fill: style.fill, stroke: style.stroke, 'stroke-width': ring, 'stroke-dasharray': dash,
  }));
  if (kind !== 'start' && kind !== 'end') {
    append(parent, create('circle', {
      cx, cy, r: Math.max(0, r - 4), fill: 'none', stroke: style.stroke, 'stroke-width': widthOf(style), 'stroke-dasharray': dash,
    }));
  }
  return outer;
}

export function drawTask(parent: SVGElement, w: number, h: number, style: ShapeStyle, thick = false): SVGElement {
  return append(parent, create('rect', {
    x: 0, y: 0, width: w, height: h, rx: CORNER_RADIUS, ry: CORNER_RADIUS,
    fill: style.fill, stroke: style.stroke, 'stroke-width': thick ? widthOf(style) * 2 : widthOf(style),
    'stroke-dasharray': style.dashArray ?? null,
  }));
}

export function drawDiamond(parent: SVGElement, w: number, h: number, style: ShapeStyle): SVGElement {
  const cx = w / 2;
  const cy = h / 2;
  return append(parent, create('polygon', {
    points: `${cx},0 ${w},${cy} ${cx},${h} 0,${cy}`,
    fill: style.fill, stroke: style.stroke, 'stroke-width': widthOf(style),
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
}

export function drawDataObject(parent: SVGElement, w: number, h: number, style: ShapeStyle): SVGElement {
  const fold = Math.min(w, h) * 0.32;
  const body = append(parent, create('path', {
    d: `M0,0 L${w - fold},0 L${w},${fold} L${w},${h} L0,${h} Z`,
    fill: style.fill, stroke: style.stroke, 'stroke-width': widthOf(style), 'stroke-linejoin': 'round',
  }));
  append(parent, create('path', {
    d: `M${w - fold},0 L${w - fold},${fold} L${w},${fold}`,
    fill: 'none', stroke: style.stroke, 'stroke-width': widthOf(style), 'stroke-linejoin': 'round',
  }));
  return body;
}

export function drawDataStore(parent: SVGElement, w: number, h: number, style: ShapeStyle): SVGElement {
  const rx = w / 2;
  const ry = Math.min(h * 0.12, 8);
  const body = append(parent, create('path', {
    d: `M0,${ry} A${rx},${ry} 0 0 0 ${w},${ry} L${w},${h - ry} A${rx},${ry} 0 0 1 0,${h - ry} Z`,
    fill: style.fill, stroke: style.stroke, 'stroke-width': widthOf(style), 'stroke-linejoin': 'round',
  }));
  append(parent, create('path', {
    d: `M0,${ry} A${rx},${ry} 0 0 0 ${w},${ry} A${rx},${ry} 0 0 0 0,${ry} Z`,
    fill: 'none', stroke: style.stroke, 'stroke-width': widthOf(style),
  }));
  return body;
}

export function drawGroup(parent: SVGElement, w: number, h: number, style: ShapeStyle): SVGElement {
  return append(parent, create('rect', {
    x: 0, y: 0, width: w, height: h, rx: CORNER_RADIUS, ry: CORNER_RADIUS,
    fill: 'none', stroke: style.stroke, 'stroke-width': widthOf(style), 'stroke-dasharray': style.dashArray ?? '6,4',
  }));
}

export function drawTextAnnotation(parent: SVGElement, w: number, h: number, style: ShapeStyle): SVGElement {
  const arm = Math.min(w * 0.4, 10);
  return append(parent, create('path', {
    d: `M${arm},0 L0,0 L0,${h} L${arm},${h}`,
    fill: 'none', stroke: style.stroke, 'stroke-width': widthOf(style), 'stroke-linejoin': 'round',
  }));
}

export const PARTICIPANT_BAND = 30;

export function drawParticipant(parent: SVGElement, w: number, h: number, style: ShapeStyle): SVGElement {
  const rect = append(parent, create('rect', {
    x: 0, y: 0, width: w, height: h, rx: 4, ry: 4, fill: style.fill, stroke: style.stroke, 'stroke-width': widthOf(style),
  }));
  const band = Math.min(PARTICIPANT_BAND, w);
  append(parent, create('line', { x1: band, y1: 0, x2: band, y2: h, stroke: style.stroke, 'stroke-width': widthOf(style) }));
  return rect;
}

const CHOREOGRAPHY_BAND_HEIGHT = 20;

export function bandPath(width: number, bandHeight: number, height: number, edge: 'top' | 'bottom'): string {
  const r = CORNER_RADIUS;
  if (edge === 'top') {
    return `M0,${bandHeight} L0,${r} Q0,0 ${r},0 L${width - r},0 Q${width},0 ${width},${r} L${width},${bandHeight} Z`;
  }
  const y = height - bandHeight;
  return `M0,${y} L${width},${y} L${width},${height - r} Q${width},${height} ${width - r},${height} L${r},${height} Q0,${height} 0,${height - r} Z`;
}

export function choreographyBandHeight(height: number): number {
  return Math.min(CHOREOGRAPHY_BAND_HEIGHT, Math.floor(height / 3));
}
