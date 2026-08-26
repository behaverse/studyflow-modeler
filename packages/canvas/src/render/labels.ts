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
import type { Bounds, SceneLabel, SceneNode } from '@canvas/model/scene.ts';

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
