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

/** What {@link fit} cuts a too-long line short with. */
const ELLIPSIS = '\u2026';

/** Slack {@link fit} and {@link wrap} leave inside a box (the ported heuristic's `- 8`). */
const WRAP_PADDING = 2;

/** Baseline-to-baseline spacing of wrapped label lines (diagram units). */
export const LABEL_LINE_HEIGHT = 15;

const LINE_HEIGHT = LABEL_LINE_HEIGHT;

/**
 * Height assumed for a `bpmndi:BPMNLabel` that positions itself (`x`/`y`) but omits
 * a `dc:Bounds` height — two lines' worth. The drawer ({@link drawExternalLabel},
 * through `externalLabelLayout`) and the hit/edit box ({@link externalLabelBounds})
 * MUST assume the same one, or a positioned caption is drawn half a line away from
 * the box the inline editor opens over.
 */
const DEFAULT_LABEL_HEIGHT = LINE_HEIGHT * 2;

/**
 * Approximate rendered width of `text` at `fontSize`, from the same glyph-advance
 * heuristic {@link fit} and {@link wrap} measure with — so a box sized by this and a
 * line ellipsized by those agree. Used by the inline editor to sit tight to an
 * external label's text (parity spec §5), where a fixed box would be visibly wrong.
 */
export function measureLabelWidth(text: string, fontSize: number): number {
  return text.length * fontSize * CHAR_WIDTH_RATIO;
}

/** Ellipsize `text` to fit `maxWidth` at `fontSize` (ported from choreographyLayout). */
export function fit(text: string, maxWidth: number, fontSize: number): string {
  const perChar = fontSize * CHAR_WIDTH_RATIO;
  const maxChars = Math.max(1, Math.floor((maxWidth - WRAP_PADDING) / perChar));
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)).trimEnd() + ELLIPSIS;
}

/** Word-wrap `text` into at most `maxLines` lines, ellipsizing the last (ported). */
export function wrap(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const perChar = fontSize * CHAR_WIDTH_RATIO;
  const maxChars = Math.max(1, Math.floor((maxWidth - WRAP_PADDING) / perChar));
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

/**
 * Font stack for every label the canvas draws, and for the inline editor that
 * stands in for one.
 *
 * This is the app's `MODELER_FONT_FAMILY` (`packages/modeler/src/constants.ts`),
 * which the bpmn backend hands to bpmn-js as `textRenderer.defaultStyle.fontFamily`
 * — parity spec §1 "Font stack". It is spelled out here rather than imported
 * because `packages/canvas` is a leaf package (no `@modeler/*`); the two must be
 * kept in step, and `tests/canvas-label.unit.spec.ts` asserts the exact string.
 */
export const LABEL_FONT = '"IBM Plex Sans", Helvetica, sans-serif';

interface TextOptions {
  x: number;
  y: number;
  fontSize?: number;
  fontWeight?: string;
  color: string;
  anchor?: 'start' | 'middle' | 'end';
}

/**
 * Class on every `<text>` that is an element's LABEL, as opposed to a glyph the
 * shape is made of (a gateway's ×, an icon). It is what the inline editor hides
 * while it is open — the same split diagram-js makes with `djs-label`, and the
 * reason bpmn-js can leave its editor transparent without doubling the text.
 */
export const LABEL_CLASS = 'sf-label';

function textLine(content: string, opts: TextOptions): SVGTextElement {
  const el = create('text', {
    class: LABEL_CLASS,
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
 * Padding above the caption of an EXPANDED container, and — doubled — the height of
 * the region the inline editor opens over there ({@link INTERNAL_TOP_LABEL_HEIGHT}).
 */
const TOP_LABEL_PADDING = 5;

/**
 * Height of the strip an expanded container's caption lives in: twice the centre of
 * its first line, so text centred in the strip lands exactly on the drawn line.
 */
export const INTERNAL_TOP_LABEL_HEIGHT = 2 * (TOP_LABEL_PADDING + LABEL_LINE_HEIGHT / 2);

/** The wrapped lines of a node's internal label. */
function internalLabelLines(node: SceneNode, name: string, fontSize: number): string[] {
  const maxLines = Math.max(1, Math.min(4, Math.floor(node.height / LINE_HEIGHT)));
  return wrap(name, node.width, fontSize, maxLines);
}

/**
 * Centre of the FIRST line of a node's internal label (node-local `y`).
 *
 * An expanded sub-process is a FRAME around its contents, so its name sits at the
 * top — centred over the middle would print it across the children. Everything else
 * (tasks, choreography name bands) keeps the caption in the middle of its box.
 */
function internalLabelFirstY(node: SceneNode, lines: number): number {
  if (node.isExpanded === true) return TOP_LABEL_PADDING + LINE_HEIGHT / 2;
  return node.height / 2 - ((lines - 1) * LINE_HEIGHT) / 2;
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
  const lines = internalLabelLines(node, name, fontSize);
  const firstY = internalLabelFirstY(node, lines.length);
  lines.forEach((line, i) => {
    append(container, textLine(line, {
      x: node.width / 2,
      y: firstY + i * LINE_HEIGHT,
      fontSize,
      // 400, not 600: the reference renderer draws a task's own name at the same
      // weight as every other label (parity spec §1 "Internal (task) label").
      fontWeight: '400',
      color,
    }));
  });
}

/**
 * The DIAGRAM-space box the glyphs of a node's INTERNAL label cover — the mirror of
 * {@link externalLabelTextBounds} for the captions {@link drawInternalLabel} centres
 * inside an activity, laid out by the very same rules so the two cannot drift.
 *
 * It exists because an internal label is not an element of its own: unlike an
 * external caption, nothing hit-tests it. `Canvas.handleDoubleClick` needs it to
 * answer "did the user double-click the NAME or the shape?", which is what keeps a
 * container renameable now that a double click on its body toggles it.
 *
 * `undefined` for an unnamed node, which draws no caption at all.
 */
export function internalLabelTextBounds(
  node: SceneNode,
  name: string,
  fontSize = 12,
): Bounds | undefined {
  if (!name) return undefined;
  const lines = internalLabelLines(node, name, fontSize);
  if (lines.length === 0) return undefined;
  const cy = internalLabelFirstY(node, lines.length) + ((lines.length - 1) * LINE_HEIGHT) / 2;
  const box = textBox(lines, node.width / 2, cy, fontSize);
  return { x: node.x + box.x, y: node.y + box.y, width: box.width, height: box.height };
}

/** Font size an external (below-the-shape) label is drawn at. */
export const EXTERNAL_LABEL_FONT_SIZE = 11;

/** Class on the `<g>` that IS an external label — a node's caption or an edge's name. */
export const EXTERNAL_LABEL_CLASS = 'sf-external-label';

/**
 * The id an element's label carries, both in the DI-backed {@link SceneLabel} the
 * importer builds and on the `<g>` the drawers below emit — `<owner>_label`, which
 * is how diagram-js registers an external label as its own element.
 */
export function labelIdOf(owner: { id: string }): string {
  return `${owner.id}_label`;
}

/**
 * The most lines any label wraps into — a ceiling on the search {@link wrapsInto}
 * runs, not a layout rule (a box tall enough for more has stopped being a caption).
 */
const MAX_WRAP_LINES = 20;

/**
 * Widest single word of `name`: the narrowest a box can be and still wrap the text
 * without cutting a word short. The floor a label resize clamps to
 * ({@link labelMinSize}).
 */
function longestWordWidth(name: string, fontSize: number): number {
  const words = name.split(/\s+/).filter(Boolean);
  return Math.max(0, ...words.map((word) => measureLabelWidth(word, fontSize)));
}

/**
 * The smallest box a caption may be resized to: wide enough for its longest word and
 * one line tall, so a resize can never produce a box its own text does not fit —
 * which is what keeps {@link wrapsInto} saying yes for every box a user drew.
 */
export function labelMinSize(
  name: string,
  fontSize = EXTERNAL_LABEL_FONT_SIZE,
): { width: number; height: number } {
  return { width: longestWordWidth(name, fontSize) + WRAP_PADDING, height: LINE_HEIGHT };
}

/**
 * How tall a caption box must be to hold `name` at `width` — the grow-to-fit a label
 * resize clamps against, so a box a user drags short simply stops shrinking instead
 * of ellipsizing its own text (and stays a box {@link wrapsInto} accepts).
 */
export function fitLabelHeight(
  name: string,
  width: number,
  fontSize = EXTERNAL_LABEL_FONT_SIZE,
): number {
  return wrap(name, width, fontSize, MAX_WRAP_LINES).length * LINE_HEIGHT;
}

/**
 * `name` wrapped to `box`, or `undefined` when the box cannot hold it.
 *
 * This is what makes a caption's OWN bounds mean something: a label a user has
 * resized wraps to the box they drew, in as many lines as it is tall. A box that
 * cannot hold the text is not one: `bpmndi:BPMNLabel/dc:Bounds` in a foreign
 * document is measured with the authoring tool's font metrics, not the heuristic
 * here ({@link measureLabelWidth}), so honouring those widths verbatim would
 * ellipsize captions that are perfectly fine in the tool that wrote them. Rejecting
 * a box the text overflows leaves every such caption on the derived layout — and
 * every box this editor writes fits by construction ({@link labelMinSize} plus the
 * resize's grow-to-fit height), so a label resized here survives the round trip.
 */
function wrapsInto(name: string, box: Bounds, fontSize: number): string[] | undefined {
  const lines = wrap(name, box.width, fontSize, MAX_WRAP_LINES);
  if (lines.some((line) => line.endsWith(ELLIPSIS))) return undefined;
  if (lines.length * LINE_HEIGHT > box.height + 0.5) return undefined;
  return lines;
}

/**
 * Whether a caption carries a box of its OWN — a `bpmndi:BPMNLabel/dc:Bounds` with a
 * size, which is what a move or a resize in this editor writes. Only such a box is
 * offered to {@link wrapsInto}: a derived caption has no size to honour.
 */
function isSizedLabel(label?: SceneLabel): boolean {
  return !!label && label.x !== undefined && label.y !== undefined
    && label.width !== undefined && label.height !== undefined;
}

/** The wrapped lines, and the centre they hang off, of a node's external label. */
function externalLabelLayout(
  node: SceneNode,
  name: string,
  label?: SceneLabel,
  fontSize = EXTERNAL_LABEL_FONT_SIZE,
): { lines: string[]; cx: number; cy: number; box?: Bounds } {
  let cx = node.width / 2;
  let cy = node.height + LINE_HEIGHT * 0.9;
  // An explicit label bound is in diagram coordinates; convert to node-local.
  if (label && label.x !== undefined && label.y !== undefined) {
    cx = label.x - node.x + (label.width ?? 0) / 2;
    cy = label.y - node.y + (label.height ?? DEFAULT_LABEL_HEIGHT) / 2;
  }
  // A caption the user has SIZED is that box — the text wraps to it and the element
  // IS it, so the handles stay where they were dragged. One that is merely
  // positioned (or foreign) keeps the tight text box parity spec §2 outlines.
  const region = externalLabelBounds(node, label);
  const sized = isSizedLabel(label) ? wrapsInto(name, region, fontSize) : undefined;
  if (sized) {
    return {
      lines: sized,
      cx,
      cy,
      box: { x: region.x - node.x, y: region.y - node.y, width: region.width, height: region.height },
    };
  }
  const maxWidth = Math.max(node.width, 80);
  return { lines: wrap(name, maxWidth * 1.5, fontSize, 2), cx, cy };
}

/** The tight text box (local frame) a set of centred lines occupies. */
function textBox(lines: readonly string[], cx: number, cy: number, fontSize: number): Bounds {
  const width = Math.max(1, ...lines.map((line) => measureLabelWidth(line, fontSize)));
  const height = Math.max(1, lines.length) * LINE_HEIGHT;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/**
 * The DIAGRAM-space box the glyphs of a node's external label actually cover —
 * tight to the text, unlike {@link externalLabelBounds}, which is the wider region
 * the text is centred *in* and which the inline editor opens over.
 *
 * This is the geometry of the label as an ELEMENT (`model/externalLabel.ts`): what a
 * click on the caption hits, and what its selection outline is inset from — parity
 * spec §2 gives an external label the outline `x=-5 y=-5 w=textW+10 h=textH+10`,
 * which only means anything against the text box.
 */
export function externalLabelTextBounds(
  node: SceneNode,
  name: string,
  label?: SceneLabel,
  fontSize = EXTERNAL_LABEL_FONT_SIZE,
): Bounds {
  const { lines, cx, cy, box: sized } = externalLabelLayout(node, name, label, fontSize);
  const box = sized ?? textBox(lines, cx, cy, fontSize);
  return { x: node.x + box.x, y: node.y + box.y, width: box.width, height: box.height };
}

/**
 * Draw a node's name below the box (events, gateways, data) as its own `<g>`,
 * translated to the top-left of the text and carrying the label's own
 * `data-element-id` — so the caption is an element a user can click, outline and
 * edit, exactly as diagram-js registers an external label.
 *
 * Coordinates inside the group are label-local (`0,0` = the text box's top-left),
 * which is the frame parity spec §2's `x=-5 y=-5` outline is expressed in. The group
 * still lives inside the owner's `<g>`, so it follows the shape for free.
 *
 * Returns the group, or `undefined` for an unnamed node.
 */
export function drawExternalLabel(
  container: SVGElement,
  node: SceneNode,
  name: string,
  color: string,
  label?: SceneLabel,
  fontSize = EXTERNAL_LABEL_FONT_SIZE,
): SVGGElement | undefined {
  if (!name) return undefined;
  const { lines, cx, cy, box: sized } = externalLabelLayout(node, name, label, fontSize);
  const box = sized ?? textBox(lines, cx, cy, fontSize);
  const g = create('g', {
    class: EXTERNAL_LABEL_CLASS,
    'data-element-id': labelIdOf(node),
    'data-label-owner': node.id,
    transform: `translate(${box.x}, ${box.y})`,
  }) as SVGGElement;
  const top = (box.height - lines.length * LINE_HEIGHT) / 2;
  lines.forEach((line, i) => {
    append(g, textLine(line, {
      x: box.width / 2,
      y: top + (i + 0.5) * LINE_HEIGHT,
      fontSize,
      color,
    }));
  });
  append(container, g);
  return g;
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
  const height = DEFAULT_LABEL_HEIGHT;
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

/** How far a connection's name is set off its line (bpmn-js `FLOW_LABEL_INDENT`). */
export const FLOW_LABEL_INDENT = 15;

/** The two waypoints a connection's label hangs between (bpmn-js `getWaypointsMid`). */
function midSegment(waypoints: readonly Point[]): [Point, Point] {
  const mid = waypoints.length / 2 - 1;
  const first = waypoints[Math.floor(mid)] ?? waypoints[0];
  const second = waypoints[Math.ceil(mid + 0.01)] ?? first;
  return [first, second];
}

/**
 * The midpoint of a connection's middle SEGMENT — bpmn-js's `getWaypointsMid`, index
 * arithmetic included: `waypoints.length / 2 - 1`, floored and ceiled, which for an
 * odd waypoint count is the midpoint of the two *before* the middle one rather than
 * the middle waypoint itself. Keeps a label on the polyline instead of at the centre
 * of a bounding box the line may not pass through.
 */
export function waypointsMid(waypoints: readonly Point[]): Point {
  if (waypoints.length === 0) return { x: 0, y: 0 };
  if (waypoints.length === 1) return { ...waypoints[0] };
  const [first, second] = midSegment(waypoints);
  return { x: first.x + (second.x - first.x) / 2, y: first.y + (second.y - first.y) / 2 };
}

/**
 * Where an unpositioned connection label is CENTRED: the midpoint above, set off the
 * line by {@link FLOW_LABEL_INDENT} — up from a mostly-horizontal segment, right of a
 * mostly-vertical one (bpmn-js `getFlowLabelPosition`). Without the offset the
 * polyline runs straight through the glyphs, which is why bpmn-js needs no plate
 * behind them.
 */
export function flowLabelPosition(waypoints: readonly Point[]): Point {
  const mid = waypointsMid(waypoints);
  if (waypoints.length < 2) return mid;
  const [first, second] = midSegment(waypoints);
  const angle = Math.atan((second.y - first.y) / (second.x - first.x));
  return Math.abs(angle) < Math.PI / 2
    ? { x: mid.x, y: mid.y - FLOW_LABEL_INDENT }
    : { x: mid.x + FLOW_LABEL_INDENT, y: mid.y };
}

/**
 * The diagram-space box a connection's name is painted into — shared by the drawer
 * and by hit-testing, so the label a user sees is the label they can click. An
 * explicit `bpmndi:BPMNLabel.bounds` wins; otherwise the box is derived around
 * {@link flowLabelPosition} — beside the line, not on it.
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
  const mid = flowLabelPosition(edge.waypoints);
  return { x: mid.x - width / 2, y: mid.y - height / 2, width, height };
}

/**
 * The lines an edge's name is drawn as: wrapped to the caption's own box when it
 * holds them ({@link wrapsInto}), else the single ellipsized line the derived box
 * has always carried.
 */
function edgeLabelLines(edge: SceneEdge, name: string, label?: SceneLabel): string[] {
  const region = edgeLabelBounds(edge, name, label);
  const sized = isSizedLabel(label) ? wrapsInto(name, region, EDGE_LABEL_FONT_SIZE) : undefined;
  return sized ?? [fit(name, region.width * 1.5, EDGE_LABEL_FONT_SIZE)];
}

/**
 * The DIAGRAM-space box an edge label's glyphs cover — tight to the text, the
 * counterpart of {@link externalLabelTextBounds} for connections. It is the label's
 * geometry as an ELEMENT: what a click hits and what the outline is inset from.
 */
export function edgeLabelTextBounds(edge: SceneEdge, name: string, label?: SceneLabel): Bounds {
  const region = edgeLabelBounds(edge, name, label);
  if (isSizedLabel(label) && wrapsInto(name, region, EDGE_LABEL_FONT_SIZE)) return region;
  return textBox(
    edgeLabelLines(edge, name, label),
    region.x + region.width / 2,
    region.y + region.height / 2,
    EDGE_LABEL_FONT_SIZE,
  );
}

/**
 * Draw a connection's name into its own `<g>`, translated to the top-left of the
 * text so everything inside is label-local (see {@link drawExternalLabel}).
 *
 * There is deliberately NO plate behind the glyphs: bpmn-js draws a connection label
 * as bare text over the canvas, and the white halo this used to paint was visible
 * chrome the reference does not have (parity gap §9). Returns the group, or
 * `undefined` for an unnamed edge.
 */
export function drawEdgeLabel(
  container: SVGElement,
  edge: SceneEdge,
  name: string,
  color: string,
  label?: SceneLabel,
): SVGGElement | undefined {
  if (!name) return undefined;
  const box = edgeLabelTextBounds(edge, name, label);
  // Its own `data-element-id` (`<edge>_label`), matching how a diagram-js external
  // label is registered — an app or a test can address the label, and clicking it
  // selects it (`model/externalLabel.ts`).
  const g = create('g', {
    class: EXTERNAL_LABEL_CLASS,
    'data-element-id': labelIdOf(edge),
    'data-label-owner': edge.id,
    transform: `translate(${box.x}, ${box.y})`,
  }) as SVGGElement;
  const lines = edgeLabelLines(edge, name, label);
  const top = (box.height - lines.length * LINE_HEIGHT) / 2;
  lines.forEach((line, i) => {
    append(g, textLine(line, {
      x: box.width / 2,
      y: top + (i + 0.5) * LINE_HEIGHT,
      fontSize: EDGE_LABEL_FONT_SIZE,
      color,
    }));
  });
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
