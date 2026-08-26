/**
 * Label layout (design §3 `render/labels.ts`, §2 "Labels"). Ports the pure text
 * `fit`/`wrap` helpers from `draw/choreographyLayout.ts` and adds internal (centred
 * inside tasks/bands) vs external (below events/gateways/data) placement.
 *
 * External labels honor an explicit `bpmndi:BPMNLabel.bounds` when the DI carries
 * one (the importer copies it onto {@link SceneLabel}); otherwise placement is
 * derived below the owner node.
 */

import { append, create } from '@canvas/render/svg.ts';
import type { Bounds, Point, SceneEdge, SceneLabel, SceneNode } from '@canvas/model/scene.ts';

/** Approx glyph advance as a fraction of font size — matches the ported heuristic. */
const CHAR_WIDTH_RATIO = 0.58;

/** Baseline-to-baseline spacing of wrapped label lines (diagram units). */
export const LABEL_LINE_HEIGHT = 15;

const LINE_HEIGHT = LABEL_LINE_HEIGHT;

/** Ellipsize `text` to fit `maxWidth` at `fontSize` (ported from choreographyLayout). */
export function fit(text: string, maxWidth: number, fontSize: number): string {
  const perChar = fontSize * CHAR_WIDTH_RATIO;
  const maxChars = Math.max(1, Math.floor((maxWidth - 8) / perChar));
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)).trimEnd() + '…';
}

/** Word-wrap `text` into at most `maxLines` lines, ellipsizing the last (ported). */
export function wrap(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const perChar = fontSize * CHAR_WIDTH_RATIO;
  const maxChars = Math.max(1, Math.floor((maxWidth - 8) / perChar));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
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

/** Font stack for labels — a plain system stack; the canvas bundles no font. */
export const LABEL_FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

interface TextOptions {
  x: number;
  y: number;
  fontSize?: number;
  fontWeight?: string;
  color: string;
  anchor?: 'start' | 'middle' | 'end';
}

function textLine(content: string, opts: TextOptions): SVGTextElement {
  const el = create('text', {
    x: opts.x,
    y: opts.y,
    fill: opts.color,
    'font-size': opts.fontSize ?? 12,
    'font-weight': opts.fontWeight ?? '400',
    'font-family': LABEL_FONT,
    'text-anchor': opts.anchor ?? 'middle',
    'dominant-baseline': 'middle',
    'stroke-width': 0,
  }) as SVGTextElement;
  el.textContent = content;
  return el;
}

/**
 * Draw a node's name centred inside its box (tasks, subprocesses, participants),
 * wrapped to the available height. Coordinates are node-local (origin `0,0`).
 */
export function drawInternalLabel(
  container: SVGElement,
  node: SceneNode,
  name: string,
  color: string,
  fontSize = 12,
): void {
  if (!name) return;
  const maxLines = Math.max(1, Math.min(4, Math.floor(node.height / LINE_HEIGHT)));
  const lines = wrap(name, node.width, fontSize, maxLines);
  const firstY = node.height / 2 - ((lines.length - 1) * LINE_HEIGHT) / 2;
  lines.forEach((line, i) => {
    append(container, textLine(line, {
      x: node.width / 2,
      y: firstY + i * LINE_HEIGHT,
      fontSize,
      fontWeight: '600',
      color,
    }));
  });
}

/**
 * Draw a node's name below the box (events, gateways, data). Coordinates are
 * node-local; honors an explicit label DI bound when present via `label`.
 */
export function drawExternalLabel(
  container: SVGElement,
  node: SceneNode,
  name: string,
  color: string,
  label?: SceneLabel,
  fontSize = 11,
): void {
  if (!name) return;
  let cx = node.width / 2;
  let cy = node.height + LINE_HEIGHT * 0.9;
  // An explicit label bound is in diagram coordinates; convert to node-local.
  if (label && label.x !== undefined && label.y !== undefined) {
    cx = label.x - node.x + (label.width ?? 0) / 2;
    cy = label.y - node.y + (label.height ?? LINE_HEIGHT) / 2;
  }
  const maxWidth = Math.max(node.width, 80);
  const lines = wrap(name, maxWidth * 1.5, fontSize, 2);
  const firstY = cy - ((lines.length - 1) * LINE_HEIGHT) / 2;
  lines.forEach((line, i) => {
    append(container, textLine(line, {
      x: cx,
      y: firstY + i * LINE_HEIGHT,
      fontSize,
      color,
    }));
  });
}

/**
 * The diagram-space rectangle {@link drawExternalLabel} paints into — the single
 * source of truth shared with `interaction/labelEditing.ts`, so the inline editor
 * opens exactly where the label is drawn. An explicit `bpmndi:BPMNLabel.bounds`
 * (copied onto {@link SceneLabel} by the importer) wins; otherwise the box is derived
 * below the owner node from the same constants the drawer uses.
 */
export function externalLabelBounds(node: SceneNode, label?: SceneLabel): Bounds {
  const width = Math.max(node.width, 80) * 1.5;
  const height = LINE_HEIGHT * 2;
  if (label && label.x !== undefined && label.y !== undefined) {
    return {
      x: label.x,
      y: label.y,
      width: label.width ?? width,
      height: label.height ?? height,
    };
  }
  return {
    x: node.x + node.width / 2 - width / 2,
    y: node.y + node.height + LINE_HEIGHT * 0.9 - height / 2,
    width,
    height,
  };
}

/** Font size an edge label is drawn at. */
export const EDGE_LABEL_FONT_SIZE = 11;

/**
 * The point an unpositioned connection label hangs off — the same rule diagram-js
 * uses: the middle waypoint when there is an odd number of them, otherwise the
 * midpoint of the two middle ones. Keeps a label on the polyline instead of at the
 * centre of a bounding box the line may not pass through.
 */
export function waypointsMid(waypoints: readonly Point[]): Point {
  if (waypoints.length === 0) return { x: 0, y: 0 };
  if (waypoints.length === 1) return { ...waypoints[0] };
  const middle = Math.floor(waypoints.length / 2);
  if (waypoints.length % 2 === 1) return { ...waypoints[middle] };
  const a = waypoints[middle - 1];
  const b = waypoints[middle];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * The diagram-space box a connection's name is painted into — shared by the drawer
 * and by hit-testing, so the label a user sees is the label they can click. An
 * explicit `bpmndi:BPMNLabel.bounds` wins; otherwise the box is derived around
 * {@link waypointsMid}.
 */
export function edgeLabelBounds(edge: SceneEdge, name: string, label?: SceneLabel): Bounds {
  const height = LINE_HEIGHT;
  const width = Math.max(24, name.length * EDGE_LABEL_FONT_SIZE * CHAR_WIDTH_RATIO + 8);
  if (label && label.x !== undefined && label.y !== undefined) {
    return {
      x: label.x,
      y: label.y,
      width: label.width ?? width,
      height: label.height ?? height,
    };
  }
  const mid = waypointsMid(edge.waypoints);
  return { x: mid.x - width / 2, y: mid.y - height / 2, width, height };
}

/**
 * Draw a connection's name into its own `<g>` (diagram coordinates, so the group
 * carries no transform of its own). Returns the group, or `undefined` for an
 * unnamed edge.
 */
export function drawEdgeLabel(
  container: SVGElement,
  edge: SceneEdge,
  name: string,
  color: string,
  label?: SceneLabel,
): SVGGElement | undefined {
  if (!name) return undefined;
  const box = edgeLabelBounds(edge, name, label);
  // Its own `data-element-id` (`<edge>_label`), matching how a diagram-js external
  // label is registered — an app or a test can address the label, and clicking it
  // selects the connection it names (`interaction/hit.ts`).
  const g = create('g', {
    class: 'sf-external-label',
    'data-element-id': `${edge.id}_label`,
    'data-label-owner': edge.id,
  }) as SVGGElement;
  // An opaque plate so the polyline does not run through the glyphs.
  append(g, create('rect', {
    x: box.x, y: box.y, width: box.width, height: box.height,
    fill: '#ffffff', stroke: 'none', opacity: 0.85, rx: 2, ry: 2,
  }));
  append(g, textLine(fit(name, box.width * 1.5, EDGE_LABEL_FONT_SIZE), {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    fontSize: EDGE_LABEL_FONT_SIZE,
    color,
  }));
  append(container, g);
  return g;
}

/** Centred single line of text (choreography band names). Node-local coordinates. */
export function drawBandText(
  container: SVGElement,
  content: string,
  cx: number,
  cy: number,
  maxWidth: number,
  color: string,
  fontSize: number,
  fontWeight: string,
): void {
  if (!content) return;
  append(container, textLine(fit(content, maxWidth, fontSize), {
    x: cx, y: cy, fontSize, fontWeight, color,
  }));
}
