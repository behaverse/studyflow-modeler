/** Where a click-append lands: one gap to the right of the source, nudged down until free. */

import { BPMN } from '@core/constants.ts';

import { createShape, type CreatePrototype, type ShapeDescriptor } from '@canvas/interaction/create.ts';
import type { Bounds, Point, SceneEdge, SceneNode } from '@canvas/model/scene.ts';
import { routableEnd } from '@canvas/routing/orthogonal.ts';

export const APPEND_DISTANCE = 50;
export const ANNOTATION_APPEND_DISTANCE = 50;
export const APPEND_NUDGE = 100;
const MAX_PROBES = 200;

/** The centre a shape of `size` appended from `source` takes; an annotation hangs above. */
export function appendPosition(source: Bounds, size: { width: number; height: number }, type?: string): Point {
  if (type === BPMN.TextAnnotation) {
    return {
      x: source.x + source.width + size.width / 2,
      y: source.y - ANNOTATION_APPEND_DISTANCE - size.height / 2,
    };
  }
  return { x: source.x + source.width + APPEND_DISTANCE + size.width / 2, y: source.y + source.height / 2 };
}

/** A connection appends from the middle of its path. */
export function appendSourceBounds(source: SceneNode | SceneEdge): Bounds {
  return routableEnd(source);
}

function verticalEscape(source: Bounds, size: { width: number; height: number }): number {
  return source.width / 2 + APPEND_DISTANCE + size.width / 2 + 1;
}

/** The first free centre for `size` appended from `source`; the hover ghost and the click agree on it. */
export function freeAppendPosition(
  source: Bounds,
  size: { width: number; height: number },
  type: string | undefined,
  isOccupied: (bounds: Bounds) => boolean,
): Point {
  const start = appendPosition(source, size, type);
  const up = type === BPMN.TextAnnotation;
  const step = up ? -APPEND_NUDGE : APPEND_NUDGE;
  const first = up ? -APPEND_NUDGE : Math.max(APPEND_NUDGE, verticalEscape(source, size));
  for (let probe = 0; probe < MAX_PROBES; probe += 1) {
    const offset = probe === 0 ? 0 : first + (probe - 1) * step;
    const at = { x: start.x, y: start.y + offset };
    const bounds = { x: at.x - size.width / 2, y: at.y - size.height / 2, width: size.width, height: size.height };
    if (!isOccupied(bounds)) return at;
  }
  return start;
}

export interface AutoPlaceHost {
  createElement(descriptor: ShapeDescriptor | CreatePrototype, center: Point): SceneNode | undefined;
  connectElements(source: SceneNode | SceneEdge, target: SceneNode): SceneEdge | undefined;
  isAreaOccupied(bounds: Bounds, from?: SceneNode | SceneEdge): boolean;
}

export interface AppendResult {
  shape: SceneNode;
  connection: SceneEdge | undefined;
}

export function appendElement(
  host: AutoPlaceHost,
  source: SceneNode | SceneEdge,
  descriptor: ShapeDescriptor | CreatePrototype,
): AppendResult | undefined {
  const prototype = createShape(descriptor);
  const position = freeAppendPosition(
    appendSourceBounds(source),
    prototype,
    prototype.type,
    (bounds) => host.isAreaOccupied(bounds, source),
  );
  const shape = host.createElement(prototype, position);
  if (!shape) return undefined;
  return { shape, connection: host.connectElements(source, shape) };
}
