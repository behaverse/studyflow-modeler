/**
 * Selection-outline geometry — one recipe per shape kind, mirroring bpmn-js's
 * `features/outline/OutlineProvider` and diagram-js's default `Outline`.
 *
 * The outline is NOT a uniform inset. bpmn-js gives each silhouette its own:
 *
 * | shape                    | outline                                                    |
 * |--------------------------|------------------------------------------------------------|
 * | activity / group (rx=10) | `rect` inset −5 all round, `rx` = shape `rx` + 4           |
 * | gateway                  | `rect` inset **inward** +2, `rx=4`, rotated 45° about the   |
 * |                          | centre — so it reads as a diamond around the diamond        |
 * | event                    | `circle` at the ring radius + 5 (+1 more on an end event,   |
 * |                          | whose 4px stroke makes it visually bigger)                  |
 * | everything else          | `rect` inset −5 all round, `rx=4` (diagram-js's default —   |
 * |                          | also exactly bpmn-js's external-label recipe, `textW+10`)   |
 * | connection               | none at all — a selected connection shows bendpoints only   |
 *
 * The result is expressed as a plain descriptor rather than a DOM node so it can be
 * asserted in a unit test without a DOM, and drawn once by {@link createOutline}.
 * Everything is in the element's LOCAL frame (its `<g>` already carries the
 * translate), which is why the numbers here are the ones a bpmn-js DOM dump shows.
 *
 * The stroke, its width and the visible/hidden toggle are NOT set here: they live
 * in the style layer (`view/theme.ts`), keyed off the `selected` class.
 */

import { BPMN } from '@core/constants.ts';

import { isLabelElement } from '@canvas/model/externalLabel.ts';
import type { SceneNode } from '@canvas/model/scene.ts';
import { categoryOf } from '@canvas/render/renderer.ts';
import { CORNER_RADIUS, eventRadius } from '@canvas/render/shapes.ts';
import { append, create } from '@canvas/render/svg.ts';

/** How far outside its shape an outline sits (diagram-js `Outline._outlineOffset`). */
export const OUTLINE_OFFSET = 5;

/** Corner radius of the default (square-ish) outline rect. */
export const OUTLINE_RADIUS = 4;

/** Class of the outline node inside an element's `<g>` (styled by `view/theme.ts`). */
export const OUTLINE_CLASS = 'sf-outline';

/** A resolved outline: the SVG element to mint and the attributes to give it. */
export interface OutlineSpec {
  tag: 'rect' | 'circle';
  attrs: Record<string, number | string>;
}

/** Whether an activity/artifact is drawn with the rounded activity corner. */
function isRounded(type: string): boolean {
  const category = categoryOf(type);
  return category === 'task' || category === 'group' || category === 'choreography';
}

/**
 * The outline recipe for `node`, in element-local coordinates. A node type the
 * renderer draws with a bespoke silhouette gets the matching bespoke outline; every
 * other type falls back to diagram-js's default rect.
 */
export function outlineSpecFor(node: SceneNode): OutlineSpec {
  const { width: w, height: h } = node;
  const category = categoryOf(node.type);

  // An external label takes diagram-js's DEFAULT rect (`textW+10` × `textH+10`,
  // `rx=4`) even though it belongs to an event or a gateway: the outline is around
  // the caption, not around the shape the caption names (parity spec §2).
  if (isLabelElement(node)) {
    return {
      tag: 'rect',
      attrs: {
        x: -OUTLINE_OFFSET,
        y: -OUTLINE_OFFSET,
        width: w + OUTLINE_OFFSET * 2,
        height: h + OUTLINE_OFFSET * 2,
        rx: OUTLINE_RADIUS,
      },
    };
  }

  if (category === 'gateway') {
    // Inward, and rotated: a 46x46 square turned 45° circumscribes the 50x50
    // diamond. bpmn-js does the rotation in CSS (`transform-box: fill-box`); the
    // SVG attribute is the same transform and survives serialization.
    return {
      tag: 'rect',
      attrs: {
        x: 2,
        y: 2,
        width: Math.max(0, w - 4),
        height: Math.max(0, h - 4),
        rx: OUTLINE_RADIUS,
        transform: `rotate(45, ${w / 2}, ${h / 2})`,
      },
    };
  }

  if (category === 'event') {
    // The ring, not the bounds: `+ 1` on an end event because its 4px stroke (vs
    // 2px) already pushes the visible edge half a stroke further out.
    const extra = node.type === BPMN.EndEvent ? 1 : 0;
    return {
      tag: 'circle',
      attrs: {
        cx: w / 2,
        cy: h / 2,
        r: eventRadius(w, h) + OUTLINE_OFFSET + extra,
      },
    };
  }

  return {
    tag: 'rect',
    attrs: {
      x: -OUTLINE_OFFSET,
      y: -OUTLINE_OFFSET,
      width: w + OUTLINE_OFFSET * 2,
      height: h + OUTLINE_OFFSET * 2,
      rx: isRounded(node.type) ? CORNER_RADIUS + OUTLINE_RADIUS : OUTLINE_RADIUS,
    },
  };
}

/**
 * Ensure `gfx` (an element's `<g>`) carries an up-to-date `.sf-outline` child,
 * creating it on first call — the same lazy contract as diagram-js, where an outline
 * exists only for elements that have actually been selected. Returns the outline.
 *
 * The node is re-minted rather than patched when the recipe changes tag (a shape can
 * change type in place), so a gateway that becomes a task does not keep a rotated
 * rect. Attributes are always rewritten, which is what keeps the outline true
 * through a resize.
 */
export function ensureOutline(gfx: SVGGElement, node: SceneNode): SVGElement {
  const spec = outlineSpecFor(node);
  const existing = gfx.querySelector(`.${OUTLINE_CLASS}`);
  if (existing && existing.tagName.toLowerCase() === spec.tag) {
    // A rect that stops being rotated must lose the attribute, not keep a stale one.
    if (!('transform' in spec.attrs)) existing.removeAttribute('transform');
    for (const [name, value] of Object.entries(spec.attrs)) {
      existing.setAttribute(name, String(value));
    }
    return existing as SVGElement;
  }
  existing?.parentNode?.removeChild(existing);
  const outline = create(spec.tag, { class: OUTLINE_CLASS, ...spec.attrs });
  // First child, under the shape's own paint: the outline is 2px wide and sits
  // outside the silhouette, so stacking never matters, and drawing it first keeps
  // `.sf-visual > :nth-child(1)`-style selectors pointing at the shape.
  if (gfx.firstChild) gfx.insertBefore(outline, gfx.firstChild);
  else append(gfx, outline);
  return outline;
}
