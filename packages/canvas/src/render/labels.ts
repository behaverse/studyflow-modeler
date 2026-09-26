/**
 * Drawing captions: text lines, internal labels, label elements and band text. Their geometry is
 * `study/text.ts`'s, the same heuristic layout and hit-testing use.
 */

import { isTypedChoreography } from '@canvas/study/choreography.ts';
import type { Font, TextAlign } from '@canvas/study/font.ts';
import type { Bounds, SceneLabel, SceneNode } from '@canvas/study/scene.ts';
import { fit, FONT, LINE_HEIGHT, wrap } from '@canvas/study/text.ts';
import { categoryOf } from '@core/document/outline.ts';
import { activityMarkers } from '@canvas/render/shapes.ts';
import { append, create } from '@canvas/render/svg.ts';


export const LABEL_FONT = '"IBM Plex Sans", Helvetica, sans-serif';
export const WEIGHT = { internal: '500', external: '400' } as const;

/** Height of the strip an expanded container's caption sits in. */
export const TOP_STRIP = 24;
/** The rows a task keeps clear of its name: the type glyph's at the top, the markers' at the bottom. */
export const CHROME = { head: 27, foot: 20 } as const;

const LABEL_CLASS = 'sf-label';

export interface TextStyle {
  fontSize: number;
  color: string;
  weight?: string;
  italic?: boolean;
  anchor?: 'start' | 'middle' | 'end';
}

/** `base` under whatever an element's `font` says; alignment is the caller's, it moves the anchor. */
export function styled(base: TextStyle, font: Font | undefined): TextStyle {
  if (!font) return base;
  return {
    ...base,
    ...(font.color ? { color: font.color } : {}),
    ...(font.bold ? { weight: '700' } : {}),
    ...(font.italic ? { italic: true } : {}),
  };
}

/** Where a line anchors inside `[x, x + width]` for `align`, and the anchor that goes with it. */
export function alignedX(x: number, width: number, align: TextAlign): { x: number; anchor: NonNullable<TextStyle['anchor']> } {
  if (align === 'left') return { x, anchor: 'start' };
  if (align === 'right') return { x: x + width, anchor: 'end' };
  return { x: x + width / 2, anchor: 'middle' };
}

export function textLine(content: string, x: number, y: number, style: TextStyle): SVGTextElement {
  const el = create('text', {
    class: LABEL_CLASS,
    x,
    y,
    fill: style.color,
    'font-size': style.fontSize,
    'font-weight': style.weight ?? WEIGHT.external,
    'font-style': style.italic ? 'italic' : null,
    'font-family': LABEL_FONT,
    'text-anchor': style.anchor ?? 'middle',
    'dominant-baseline': 'middle',
    'stroke-width': 0,
  }) as SVGTextElement;
  el.textContent = content;
  return el;
}

/** Draw `lines` anchored at `x` (per `style.anchor`, centred by default), the first line's centre at `firstY`. */
function drawLines(
  container: SVGElement,
  lines: readonly string[],
  x: number,
  firstY: number,
  style: TextStyle,
): void {
  lines.forEach((line, i) => append(container, textLine(line, x, firstY + i * LINE_HEIGHT, style)));
}

// --- internal labels (drawn inside the shape) --------------------------------

export function drawInternalLabel(container: SVGElement, node: SceneNode, name: string, color: string): void {
  if (!name) return;
  const region = internalLabelRegion(node, name);
  const maxLines = Math.max(1, Math.min(4, Math.floor(region.height / LINE_HEIGHT)));
  const lines = wrap(name, region.width - 4, FONT.internal, maxLines);
  const firstY = region.y + region.height / 2 - ((lines.length - 1) * LINE_HEIGHT) / 2;
  const at = alignedX(region.x + 2, region.width - 4, node.font?.align ?? 'center');
  const style = styled({ fontSize: FONT.internal, color, weight: WEIGHT.internal, anchor: at.anchor }, node.font);
  drawLines(container, lines, at.x, firstY, style);
}

/**
 * The node-local box an internal caption is centred in (and edited in). An expanded
 * container captions its top strip. A task's name sits between the glyph row and the
 * marker row whether or not it carries either, so names line up across a row of tasks;
 * a name that needs more lines than that band holds, or a shape too short for it, takes
 * the next larger box, which never reaches into the marker row while a marker is drawn
 * there. A plain choreography task has no glyph (its bands are its point), so its name
 * takes the whole middle band.
 */
export function internalLabelRegion(node: SceneNode, name = ''): Bounds {
  const { width, height } = node;
  if (node.isExpanded === true) return { x: 0, y: 0, width, height: TOP_STRIP };
  const category = categoryOf(node.type);
  const floor = activityMarkers(node).length > 0 ? height - CHROME.foot : height;
  const bands = category === 'task' || (category === 'choreography' && isTypedChoreography(node.businessObject))
    ? [[CHROME.head, height - CHROME.foot], [CHROME.head, floor]]
    : [];
  const needed = Math.max(LINE_HEIGHT, wrap(name, width - 4, FONT.internal, 4).length * LINE_HEIGHT);
  for (const [top, bottom] of bands) {
    if (bottom - top >= needed) return { x: 0, y: top, width, height: bottom - top };
  }
  return { x: 0, y: 0, width, height: floor };
}

// --- external labels (their own element) -------------------------------------

/** The lines a label draws: wrapped to its own box. */
function labelLines(label: Pick<SceneLabel, 'width'>, name: string): string[] {
  return wrap(name, label.width, FONT.external, 20);
}

const LABEL_ELEMENT_CLASS = 'sf-external-label';

/** Draw a label element's `<g>`, translated to its box, text centred inside. */
export function drawLabel(label: SceneLabel, name: string, color: string): SVGGElement {
  const g = create('g', {
    class: LABEL_ELEMENT_CLASS,
    'data-element-id': label.id,
    'data-element-type': label.type,
    'data-label-owner': label.owner.id,
    transform: `translate(${label.x}, ${label.y})`,
  }) as SVGGElement;
  const lines = labelLines(label, name);
  const top = (label.height - lines.length * LINE_HEIGHT) / 2;
  const font = label.owner.font;
  const at = alignedX(0, label.width, font?.align ?? 'center');
  drawLines(g, lines, at.x, top + LINE_HEIGHT / 2, styled({ fontSize: FONT.external, color, anchor: at.anchor }, font));
  return g;
}

/** A single ellipsized line (choreography bands, group captions). */
export function drawBandText(
  container: SVGElement,
  content: string,
  cx: number,
  cy: number,
  maxWidth: number,
  color: string,
  fontSize: number = FONT.band,
  weight: string = WEIGHT.external,
  font?: Font,
): void {
  if (!content) return;
  append(container, textLine(fit(content, maxWidth, fontSize), cx, cy, styled({ fontSize, color, weight }, font)));
}
