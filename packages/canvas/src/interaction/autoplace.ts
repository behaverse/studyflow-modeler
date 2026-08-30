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
 * The slot it picks may be TAKEN, and then it nudges downwards until one is free,
 * the way bpmn-js's `findFreePosition` does — so appending twice from one element
 * fans out instead of stacking.
 *
 * That nudge is not cosmetic. `Create.createAt` hit-tests the drop centre and asks
 * the rules whether the shape may go in whatever is under it; a slot occupied by a
 * task therefore resolves to "a task inside a task", which the rules refuse, and
 * the whole append is dropped on the floor with nothing to show for it. Appending
 * next to an existing shape simply did nothing until the search below went in.
 *
 * The module is host-agnostic on purpose — it takes the canvas entry points it
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

/**
 * Spacing between successive probes once the search is under way — one task height
 * plus a gap, so a fanned-out append column reads as a column rather than a smear.
 *
 * The FIRST step away from the original slot is usually larger; see
 * {@link verticalEscape}.
 */
export const APPEND_NUDGE = 100;

/**
 * How many slots to try before giving up and using the first one anyway. Ten rows
 * is far past any diagram a click-append is a reasonable way to build; the cap is
 * only here so a pathological document cannot spin.
 */
const MAX_PROBES = 10;

/**
 * How far down a nudged successor has to sit before its flow leaves the source
 * DOWNWARDS instead of sideways — centre-to-centre horizontal distance, plus one
 * unit to win the tie.
 *
 * `routing/orthogonal` bends a diagonal pair through a single elbow along the
 * DOMINANT axis. While the drop is nearer than it is lower, that axis is the
 * horizontal one, so the flow runs sideways at the SOURCE's y first — straight
 * under the sibling this append is dodging in the first place, and out of sight
 * behind it. Past this offset the elbow flips: the flow drops out of the source's
 * bottom and comes in at the successor's left edge, clear of the sibling.
 *
 * Fixing it here rather than in the router is deliberate. The router is explicitly
 * not obstacle-avoiding ("a third shape sitting in the way is the user's to fix by
 * dragging a waypoint, exactly as in bpmn-js"), and the single-elbow diagonal is a
 * pinned design decision. An auto-PLACER, though, exists precisely to pick a spot
 * that reads well, and it is the one thing here that knows a sibling is in the way.
 */
function verticalEscape(source: Bounds, size: { width: number; height: number }): number {
  return source.width / 2 + APPEND_DISTANCE + size.width / 2 + 1;
}

/**
 * The first FREE centre point for a shape of `size` appended from `source`.
 *
 * Probe 0 is the plain {@link appendPosition}; every probe after it steps AWAY from
 * the source — down for a flow successor, up for an annotation, which starts above
 * the source and would otherwise nudge straight back into it. The first step also
 * clears {@link verticalEscape}, so a fanned-out flow is drawn where it can be seen.
 *
 * ponytail: one direction only, and it gives up after {@link MAX_PROBES} — a source
 * with ten occupied rows under it falls back to the blocked slot and the append is
 * dropped, exactly as it was before this search existed. Alternate both ways the
 * way bpmn-js's `generateGetNextPosition` does if anyone ever hits it.
 *
 * Both the click ({@link appendElement}) and the hover ghost (`Canvas.previewAppend`)
 * go through here, because a preview that shows a different slot than the click
 * takes is worse than no preview.
 */
export function freeAppendPosition(
  source: Bounds,
  size: { width: number; height: number },
  type: string | undefined,
  isOccupied: (bounds: Bounds) => boolean,
): Point {
  const start = appendPosition(source, size, type);
  // An annotation hangs ABOVE the source, so "away" is upwards for it alone.
  const up = type === BPMN.TextAnnotation;
  const step = up ? -APPEND_NUDGE : APPEND_NUDGE;
  const first = up ? -APPEND_NUDGE : Math.max(APPEND_NUDGE, verticalEscape(source, size));

  for (let probe = 0; probe < MAX_PROBES; probe += 1) {
    const offset = probe === 0 ? 0 : first + (probe - 1) * step;
    const at = { x: start.x, y: start.y + offset };
    const bounds = {
      x: at.x - size.width / 2,
      y: at.y - size.height / 2,
      width: size.width,
      height: size.height,
    };
    if (!isOccupied(bounds)) return at;
  }
  return start;
}

/** The canvas entry points an append needs ({@link Canvas} satisfies it). */
export interface AutoPlaceHost {
  createElement(
    descriptor: ShapeDescriptor | CreatePrototype,
    center: Point,
  ): SceneNode | undefined;
  connectElements(source: SceneNode | SceneEdge, target: SceneNode): SceneEdge | undefined;
  /** Whether a shape placed at `bounds` would land on top of something. */
  isAreaOccupied(bounds: Bounds): boolean;
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
  const position = freeAppendPosition(
    appendSourceBounds(source),
    prototype,
    prototype.type,
    (bounds) => host.isAreaOccupied(bounds),
  );
  const shape = host.createElement(prototype, position);
  if (!shape) return undefined;
  return { shape, connection: host.connectElements(source, shape) };
}
