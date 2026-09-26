/**
 * Caption geometry: measuring and wrapping text, and the box an external caption takes. Widths are a
 * glyph-advance heuristic (no DOM measurement), used consistently by layout, hit-testing, drawing
 * (`render/labels.ts`) and the inline editor.
 */

import type { Bounds, Point, SceneEdge, SceneNode } from '@canvas/study/scene.ts';

export const LINE_HEIGHT = 15;
export const FONT = { internal: 12, external: 11, band: 11, annotation: 12 } as const;

const CHAR_WIDTH = 0.58;
const PAD = 2;
const ELLIPSIS = '…';

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
function flowLabelPosition(waypoints: readonly Point[]): Point {
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
