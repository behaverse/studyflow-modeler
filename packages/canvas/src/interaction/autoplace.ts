/**
 * Auto-place — where a *clicked* append lands (P6b §3A).
 *
 * Dragging a successor out of the append menu needs no solver: the pointer says
 * where it goes ({@link Canvas.startCreate}). Clicking one does, and diagram-js
 * answers it with `AutoPlace` + `BpmnAutoPlaceUtil`. This is the small, honest
 * subset of that: one fixed gap to the right of the source, vertically centred on
 * it, then a connection. The router orthogonalizes and crops the flow afterwards,
 * so nothing here computes waypoints.
 *
 * What is deliberately NOT ported: bpmn-js also *nudges* the position downwards
 * when the slot it picked is already occupied, so appending twice from one element
 * fans out. Here the second append lands on top of the first. Both are one undo
 * step, so an unwanted placement costs one undo either way.
 *
 * The module is host-agnostic on purpose — it takes the two canvas entry points it
 * needs as an interface rather than the {@link Canvas} itself, which keeps it free
 * of the import cycle `Canvas → autoplace → Canvas` and testable on a stub.
 */

import { BPMN } from '@core/constants.ts';

import { createShape } from '@canvas/interaction/create.ts';
import type { CreatePrototype, ShapeDescriptor } from '@canvas/interaction/create.ts';
import type { Bounds, Point, SceneEdge, SceneNode } from '@canvas/model/scene.ts';
import { routableEnd } from '@canvas/routing/orthogonal.ts';

/**
 * Horizontal gap between a source shape and a successor appended from it —
 * `DEFAULT_DISTANCE` in bpmn-js's `BpmnAutoPlaceUtil`, so a click-append lands
 * where a user of the other backend expects it to.
 */
export const APPEND_DISTANCE = 50;

/**
 * A text annotation is not a successor: bpmn-js's `getTextAnnotationPosition` puts
 * it ABOVE the source's top-right corner rather than in the flow lane to its right,
 * and the reference recording agrees (`edge-videos/preview/frame_08` — the ghost
 * box sits above the task, reached by a dotted association).
 */
export const ANNOTATION_APPEND_DISTANCE = 50;

/**
 * The CENTRE point a shape of `size` appended from `source` should occupy.
 *
 * `type` names what is being appended; only an artifact changes the answer (see
 * {@link ANNOTATION_APPEND_DISTANCE}). Omitting it keeps the flow-lane placement,
 * which is what every non-artifact append wants.
 */
export function appendPosition(
  source: Bounds,
  size: { width: number; height: number },
  type?: string,
): Point {
  if (type === BPMN.TextAnnotation) {
    return {
      x: source.x + source.width + size.width / 2,
      y: source.y - ANNOTATION_APPEND_DISTANCE - size.height / 2,
    };
  }
  return {
    x: source.x + source.width + APPEND_DISTANCE + size.width / 2,
    y: source.y + source.height / 2,
  };
}

/**
 * The bounds an append is measured from.
 *
 * A shape is its own box. A CONNECTION — the source of the one append a selected
 * sequence flow offers, "Add text annotation" (ux-spec §4) — is the zero-size box
 * at the middle of its path, so the annotation hangs above-right of the flow's
 * midpoint rather than of whichever end of it happens to be further right.
 */
export function appendSourceBounds(source: SceneNode | SceneEdge): Bounds {
  return routableEnd(source);
}

/** The two canvas entry points an append needs ({@link Canvas} satisfies it). */
export interface AutoPlaceHost {
  createElement(
    descriptor: ShapeDescriptor | CreatePrototype,
    center: Point,
  ): SceneNode | undefined;
  connectElements(source: SceneNode | SceneEdge, target: SceneNode): SceneEdge | undefined;
}

/** What an append produced; `connection` is absent when the rules refuse the flow. */
export interface AppendResult {
  shape: SceneNode;
  connection: SceneEdge | undefined;
}

/**
 * Place `descriptor` beside `source` and connect the two. `undefined` when the
 * rules reject the shape itself — in which case nothing was written at all.
 */
export function appendElement(
  host: AutoPlaceHost,
  source: SceneNode | SceneEdge,
  descriptor: ShapeDescriptor | CreatePrototype,
): AppendResult | undefined {
  const prototype = createShape(descriptor);
  const position = appendPosition(appendSourceBounds(source), prototype, prototype.type);
  const shape = host.createElement(prototype, position);
  if (!shape) return undefined;
  return { shape, connection: host.connectElements(source, shape) };
}
