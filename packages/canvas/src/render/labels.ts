/**
 * Text: measuring, wrapping and drawing captions. Widths are a glyph-advance
 * heuristic (no DOM measurement), used consistently by layout, hit-testing and the
 * inline editor.
 */

import { isTypedChoreography } from '@canvas/model/choreography.ts';
import type { Bounds, Point, SceneEdge, SceneLabel, SceneNode } from '@canvas/model/scene.ts';
import { categoryOf } from '@canvas/render/shapes.ts';
import { append, create } from '@canvas/render/svg.ts';

export const LABEL_FONT = '"IBM Plex Sans", Helvetica, sans-serif';
export const LINE_HEIGHT = 15;
export const FONT = { internal: 12, external: 11, band: 11, annotation: 12 } as const;
export const WEIGHT = { internal: '500', external: '400' } as const;

const CHAR_WIDTH = 0.58;
const PAD = 2;
const ELLIPSIS = '…';
/** Height of the strip an expanded container's caption sits in. */
export const TOP_STRIP = 24;
/** The rows a task keeps clear of its name: the type glyph's at the top, the markers' at the bottom. */
export const CHROME = { head: 27, foot: 20 } as const;

/** The box a line of text needs (heuristic; includes the padding `wrap` leaves). */
export function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH + PAD;
}

export function fit(text: string, maxWidth: number, fontSize: number): string {
  const maxChars = Math.max(1, Math.floor((maxWidth - PAD) / (fontSize * CHAR_WIDTH) + 1e-6));
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)).trimEnd() + ELLIPSIS;
}

export function wrap(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const maxChars = Math.max(1, Math.floor((maxWidth - PAD) / (fontSize * CHAR_WIDTH) + 1e-6));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (let i = 0; i < words.length; i += 1) {
    const candidate = current ? `${current} ${words[i]}` : words[i];
    if (candidate.length <= maxChars || !current) {
      current = candidate;
      continue;
    }
    if (lines.length === maxLines - 1) {
      current = `${current} ${words.slice(i).join(' ')}`;
      break;
    }
    lines.push(fit(current, maxWidth, fontSize));
    current = words[i];
  }
  if (current) lines.push(fit(current, maxWidth, fontSize));
  return lines;
}

export const LABEL_CLASS = 'sf-label';

export interface TextStyle {
  fontSize: number;
  color: string;
  weight?: string;
  anchor?: 'start' | 'middle' | 'end';
}

export function textLine(content: string, x: number, y: number, style: TextStyle): SVGTextElement {
  const el = create('text', {
    class: LABEL_CLASS,
    x,
    y,
    fill: style.color,
    'font-size': style.fontSize,
    'font-weight': style.weight ?? WEIGHT.external,
    'font-family': LABEL_FONT,
    'text-anchor': style.anchor ?? 'middle',
    'dominant-baseline': 'middle',
    'stroke-width': 0,
  }) as SVGTextElement;
  el.textContent = content;
  return el;
}

/** Draw `lines` centred on `cx`, the first line's centre at `firstY`. */
export function drawLines(
  container: SVGElement,
  lines: readonly string[],
  cx: number,
  firstY: number,
  style: TextStyle,
): void {
  lines.forEach((line, i) => append(container, textLine(line, cx, firstY + i * LINE_HEIGHT, style)));
}

// --- internal labels (drawn inside the shape) --------------------------------

export function drawInternalLabel(container: SVGElement, node: SceneNode, name: string, color: string): void {
  if (!name) return;
  const region = internalLabelRegion(node, name);
  const maxLines = Math.max(1, Math.min(4, Math.floor(region.height / LINE_HEIGHT)));
  const lines = wrap(name, region.width - 4, FONT.internal, maxLines);
  const firstY = region.y + region.height / 2 - ((lines.length - 1) * LINE_HEIGHT) / 2;
  drawLines(container, lines, region.x + region.width / 2, firstY, { fontSize: FONT.internal, color, weight: WEIGHT.internal });
}

/**
 * The node-local box an internal caption is centred in (and edited in). An expanded
 * container captions its top strip. A task's name sits between the glyph row and the
 * marker row whether or not it carries either, so names line up across a row of tasks;
 * a name that needs more lines than that band holds, or a shape too short for it, takes
 * the next larger box. A plain choreography task has no glyph (its bands are its point),
 * so its name takes the whole middle band.
 */
export function internalLabelRegion(node: SceneNode, name = ''): Bounds {
  const { width, height } = node;
  if (node.isExpanded === true) return { x: 0, y: 0, width, height: TOP_STRIP };
  const category = categoryOf(node.type);
  const bands = category === 'task' || (category === 'choreography' && isTypedChoreography(node.businessObject))
    ? [[CHROME.head, height - CHROME.foot], [CHROME.head, height]]
    : [];
  const needed = Math.max(LINE_HEIGHT, wrap(name, width - 4, FONT.internal, 4).length * LINE_HEIGHT);
  for (const [top, bottom] of bands) {
    if (bottom - top >= needed) return { x: 0, y: top, width, height: bottom - top };
  }
  return { x: 0, y: 0, width, height };
}

// --- external labels (their own element) -------------------------------------

/** The box for `lines` centred on `(cx, cy)`. */
function boxAround(lines: readonly string[], cx: number, cy: number, fontSize: number): Bounds {
  const width = Math.max(textWidth('  ', fontSize), ...lines.map((line) => textWidth(line, fontSize)));
  const height = Math.max(1, lines.length) * LINE_HEIGHT;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/** Where a node's caption goes by default: centred below the shape. */
export function nodeLabelBox(node: SceneNode, name: string): Bounds {
  const lines = wrap(name, Math.max(node.width, 80) * 1.5, FONT.external, 3);
  const box = boxAround(lines, 0, 0, FONT.external);
  return {
    x: node.x + node.width / 2 - box.width / 2,
    y: node.y + node.height + 6,
    width: box.width,
    height: box.height,
  };
}

const FLOW_LABEL_INDENT = 15;

function midSegment(waypoints: readonly Point[]): [Point, Point] {
  const mid = waypoints.length / 2 - 1;
  const first = waypoints[Math.floor(mid)] ?? waypoints[0];
  const second = waypoints[Math.ceil(mid + 0.01)] ?? first;
  return [first, second];
}

/** The centre of an edge's default caption: the middle segment's midpoint, set off the line. */
export function flowLabelPosition(waypoints: readonly Point[]): Point {
  if (waypoints.length === 0) return { x: 0, y: 0 };
  if (waypoints.length === 1) return { ...waypoints[0] };
  const [a, b] = midSegment(waypoints);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const angle = Math.atan((b.y - a.y) / (b.x - a.x));
  return Math.abs(angle) < Math.PI / 2
    ? { x: mid.x, y: mid.y - FLOW_LABEL_INDENT }
    : { x: mid.x + FLOW_LABEL_INDENT, y: mid.y };
}

export function edgeLabelBox(edge: SceneEdge, name: string): Bounds {
  const lines = wrap(name, 200, FONT.external, 3);
  const at = flowLabelPosition(edge.waypoints);
  return boxAround(lines, at.x, at.y, FONT.external);
}

/** The lines a label draws: wrapped to its own box. */
export function labelLines(label: Pick<SceneLabel, 'width'>, name: string): string[] {
  return wrap(name, label.width, FONT.external, 20);
}

/** The narrowest a caption may be resized to: its longest word, one line tall. */
export function labelMinSize(name: string): { width: number; height: number } {
  const words = name.split(/\s+/).filter(Boolean);
  return {
    width: Math.max(textWidth('  ', FONT.external), ...words.map((w) => textWidth(w, FONT.external))),
    height: LINE_HEIGHT,
  };
}

export function labelHeightFor(name: string, width: number): number {
  return Math.max(1, wrap(name, width, FONT.external, 20).length) * LINE_HEIGHT;
}

export const LABEL_ELEMENT_CLASS = 'sf-external-label';

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
  drawLines(g, lines, label.width / 2, top + LINE_HEIGHT / 2, { fontSize: FONT.external, color });
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
): void {
  if (!content) return;
  append(container, textLine(fit(content, maxWidth, fontSize), cx, cy, { fontSize, color, weight }));
}
