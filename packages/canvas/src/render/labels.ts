/**
 * Drawing captions: text lines, internal labels, label elements and band text. Their geometry is
 * `study/text.ts`'s, the same heuristic layout and hit-testing use.
 */

import type { Font, TextAlign } from '@canvas/study/font.ts';
import type { Bounds, SceneLabel, SceneNode } from '@canvas/study/scene.ts';
import { CHAR_WIDTH, fit, FONT, LINE_HEIGHT, wrap } from '@canvas/study/text.ts';
import { categoryOf } from '@core/document/outline.ts';
import { activityMarkers } from '@canvas/render/shapes.ts';
import { append, create } from '@canvas/render/svg.ts';

export const LABEL_FONT = '"IBM Plex Sans", Helvetica, sans-serif';
/** The face for text that reads as prose beside the diagram: a note (a BPMN text annotation), and nothing else. */
export const NOTE_FONT = '"IBM Plex Serif", ui-serif, Georgia, serif';

/** The face the text an element of `type` holds is set in. */
export function familyOf(type: string): string {
  const category = categoryOf(type);
  return category === 'annotation' ? NOTE_FONT : LABEL_FONT;
}
export const WEIGHT = { internal: '500', external: '400' } as const;

/** Height of the strip an expanded container's caption sits in. */
export const TOP_STRIP = 24;
/**
 * The rows a task's name keeps clear of: where a line's box may start for its letters to pass under the type glyph,
 * and the markers' row at the bottom.
 */
export const CHROME = { head: 24, foot: 20 } as const;

const LABEL_CLASS = 'sf-label';

export interface TextStyle {
  fontSize: number;
  color: string;
  weight?: string;
  italic?: boolean;
  /** `LABEL_FONT` when not said. */
  family?: string;
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
    'font-family': style.family ?? LABEL_FONT,
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

/** The most lines of a name, however tall its shape. */
const MAX_LINES = 4;
/** What a name's letters take on average, in ems: less than the room `wrap` keeps for them, which would cut a name that stands clear of a glyph. */
const LETTER_WIDTH = 0.5;

/** The gap a name on one row keeps from the glyphs on it, and from the shape's top and bottom. */
const ROW_GAP = 6;
const ROW_MARGIN = 3;

/** How far the glyphs a shape draws reach in from its sides, 0 where it draws none (`Renderer.glyphReach`). */
export interface GlyphReach {
  /** The type glyph, in the top-left corner. */
  left: number;
  /** The badges, in the top-right corner. */
  right: number;
  /** The badges and the markers, when they stand on one row with the name. */
  row: number;
}

export const NO_GLYPHS: GlyphReach = { left: 0, right: 0, row: 0 };

/** How a shape's name is set, in the shape's frame. */
interface Caption {
  lines: string[];
  /** The top of the first line's box. */
  top: number;
  /** The span the lines are aligned in. */
  x: number;
  width: number;
  align: TextAlign;
  /** Whether the shape is too short to stack: its glyphs stand level with its name. */
  row: boolean;
}

/** The lowest a shape's name reaches: the shape's foot, or the marker row when it draws one. */
function floorOf(node: SceneNode): number {
  return activityMarkers(node).length > 0 ? node.height - CHROME.foot : node.height;
}

/**
 * Set `name` centred on the shape, so names line up across a row of shapes whatever each one draws, and moved up only
 * as far as a marker row asks. A line that falls in the glyphs' row stays when it stands clear between them; else the
 * name goes under them, cut short if the room there is too little. Where that room is one line or less, the glyphs
 * stand level with the name, which wraps beside them as far as the height lets it; a shape with no name keeps its
 * glyphs where they are. An expanded container captions its top strip, between the glyphs.
 */
function captionOf(node: SceneNode, name: string, reach: GlyphReach): Caption {
  const { width, height } = node;
  const room = width - 4;
  const align = node.font?.align ?? 'center';
  const aside = Math.max(reach.left, reach.right);
  if (node.isExpanded === true) {
    const strip = room - 2 * aside;
    return { lines: wrap(name, strip, FONT.internal, 1), top: (TOP_STRIP - LINE_HEIGHT) / 2, x: 2 + aside, width: strip, align, row: false };
  }
  const rows = (space: number): number => Math.max(1, Math.min(MAX_LINES, Math.floor(space / LINE_HEIGHT)));
  const oneRow = (): Caption => {
    const x = reach.left > 0 ? reach.left + ROW_GAP : 2;
    const span = Math.max(0, width - (reach.row > 0 ? reach.row + ROW_GAP : 2) - x);
    // Room is scarce here: wrapped by what its letters take, so a line that fits is not cut.
    const beside = wrap(name, (span * CHAR_WIDTH) / LETTER_WIDTH, FONT.internal, rows(height - 2 * ROW_MARGIN));
    const set = node.font?.align ?? (reach.left > 0 ? 'left' : 'center');
    return { lines: beside, top: (height - beside.length * LINE_HEIGHT) / 2, x, width: span, align: set, row: true };
  };
  const floor = floorOf(node);
  const head = aside > 0 ? CHROME.head : 0;
  if (name && floor - head < LINE_HEIGHT) return oneRow();
  const centred = (count: number): number => Math.max(0, Math.min((height - count * LINE_HEIGHT) / 2, floor - count * LINE_HEIGHT));
  const lines = wrap(name, room, FONT.internal, rows(floor));
  const top = centred(lines.length);
  // A line set to one side runs along the glyph on that side, however short it is.
  const between = align === 'center' ? width - 2 * aside : 0;
  const clear = aside === 0 || lines.every((line, i) => top + i * LINE_HEIGHT >= CHROME.head || line.length * FONT.internal * LETTER_WIDTH <= between);
  if (clear) return { lines, top, x: 2, width: room, align, row: false };
  if (floor - head < 2 * LINE_HEIGHT) return oneRow();
  const under = wrap(name, room, FONT.internal, rows(floor - head));
  return { lines: under, top: Math.max(head, centred(under.length)), x: 2, width: room, align, row: false };
}

/** Whether a shape's glyphs stand level with its name, on one row. */
export function isOneRow(node: SceneNode, name: string, reach: GlyphReach): boolean {
  return captionOf(node, name, reach).row;
}

export function drawInternalLabel(container: SVGElement, node: SceneNode, name: string, color: string, reach = NO_GLYPHS): void {
  if (!name) return;
  const { lines, top, x, width, align } = captionOf(node, name, reach);
  const at = alignedX(x, width, align);
  const style = styled({ fontSize: FONT.internal, color, weight: WEIGHT.internal, anchor: at.anchor }, node.font);
  drawLines(container, lines, at.x, top + LINE_HEIGHT / 2, style);
}

/**
 * The node-local box an internal caption is edited in, and how its text is aligned: as much of the shape as stays
 * centred on the name as drawn, so the text holds still when the editor opens. An expanded container captions its top
 * strip; a name on one row with its glyphs keeps the span between them.
 */
export function internalLabelRegion(node: SceneNode, name = '', reach = NO_GLYPHS): Bounds & { align: TextAlign } {
  const { width, height } = node;
  const { lines, top, x, width: span, align, row } = captionOf(node, name, reach);
  if (node.isExpanded === true) return { x: 0, y: 0, width, height: TOP_STRIP, align };
  if (row) return { x, y: 0, width: span, height, align };
  const centre = top + (Math.max(1, lines.length) * LINE_HEIGHT) / 2;
  const half = Math.min(centre, floorOf(node) - centre);
  return { x: 0, y: centre - half, width, height: 2 * half, align };
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
