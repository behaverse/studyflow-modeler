/**
 * The canvas style layer — one place every editor-chrome colour and weight lives.
 *
 * The shapes a diagram is made of keep their presentation ATTRIBUTES (the DI can
 * colour them per element, and an exported SVG has to carry its own paint), but
 * everything that is *editor chrome* — selection outlines, resize handles,
 * bendpoints, the drag ghost, snap lines, the lasso — is painted from here, through
 * CSS custom properties that mirror diagram-js's own token names one for one:
 *
 *     diagram-js                                     canvas
 *     --element-selected-outline-stroke-color   →    --sf-element-selected-outline-stroke-color
 *     --resizer-fill-color                      →    --sf-resizer-fill-color
 *     --bendpoint-fill-color                    →    --sf-bendpoint-fill-color
 *     --snap-line-stroke-color                  →    --sf-snap-line-stroke-color
 *     --lasso-fill-color                        →    --sf-lasso-fill-color
 *     --element-dragger-color                   →    --sf-element-dragger-color
 *
 * so the two backends can be re-themed with the same vocabulary and a value can be
 * checked against the parity spec by reading one file.
 *
 * The tokens are declared on `.sf-canvas` (the root `<svg>`), not on `:root`, which
 * is what makes the sheet theme-safe: a host redefines any of them for its dark
 * theme by writing `.sf-canvas { --sf-… }` in its own stylesheet with no `!important`
 * arms race, and nothing here inherits `currentColor` or the page's colour scheme.
 * The white on a handle or a bendpoint is derived from `--sf-canvas-fill-color`
 * (diagram-js derives it from `--canvas-fill-color`), so re-theming the canvas
 * background carries the chrome with it.
 *
 * Stroke widths are CSS pixels, which inside the root `viewBox` means *diagram*
 * units — exactly as in diagram-js, where the same widths sit inside the viewport
 * transform. Chrome therefore scales with zoom on both backends.
 */

/** `id` of the injected `<style>` element (one per document). */
export const CANVAS_STYLE_ID = 'sf-canvas-style';

/**
 * The canvas chrome stylesheet. Exported as text so a host that would rather ship
 * it through its own CSS pipeline can inline it instead of letting
 * {@link injectCanvasStyles} add a `<style>` tag.
 */
export const CANVAS_CSS = `
.sf-canvas {
  /* diagram-js palette, verbatim. hsl(205,100%,45%) = rgb(0,134,230),
     hsl(205,100%,50%) = rgb(0,149,255), hsl(205,100%,75%) = rgb(128,202,255). */
  --sf-color-blue-205-100-45: hsl(205, 100%, 45%);
  --sf-color-blue-205-100-50: hsl(205, 100%, 50%);
  --sf-color-blue-205-100-75: hsl(205, 100%, 75%);
  --sf-canvas-fill-color: hsl(0, 0%, 100%);

  --sf-element-selected-outline-stroke-color: var(--sf-color-blue-205-100-50);
  --sf-element-selected-outline-secondary-stroke-color: var(--sf-color-blue-205-100-75);
  --sf-element-dragger-color: var(--sf-color-blue-205-100-50);
  --sf-element-dragging-opacity: 0.3;

  --sf-resizer-fill-color: var(--sf-color-blue-205-100-45);
  --sf-resizer-stroke-color: var(--sf-canvas-fill-color);

  --sf-bendpoint-fill-color: var(--sf-color-blue-205-100-45);
  --sf-bendpoint-stroke-color: var(--sf-canvas-fill-color);

  --sf-snap-line-stroke-color: hsla(205, 100%, 45%, 0.3);

  --sf-lasso-fill-color: hsla(205, 100%, 50%, 0.15);
  --sf-lasso-stroke-color: var(--sf-element-selected-outline-stroke-color);

  --sf-drop-ok-fill-color: hsl(225, 10%, 97%);
  --sf-drop-not-ok-fill-color: hsl(360, 100%, 97%);

  /* Empty canvas is a pan surface (parity spec §10), so the root reads as one:
     \`grab\` at rest, \`grabbing\` while it is actually being dragged — diagram-js's
     \`djs-cursor-grab\` / \`djs-cursor-grabbing\`, expressed as root state classes. */
  cursor: grab;
}

/* …but only over the canvas itself: bpmn-js leaves the cursor alone over an element
   (its own probe reads \`default\` there), and a grab hand over a shape would promise
   a gesture that is a move, not a pan. */
.sf-canvas .sf-shape,
.sf-canvas .sf-connection {
  cursor: default;
}

.sf-canvas.sf-panning,
.sf-canvas.sf-panning * {
  cursor: grabbing;
}

/* The palette's lasso tool is armed: the next drag lassoes rather than pans. */
.sf-canvas.sf-lasso-tool,
.sf-canvas.sf-lasso-tool * {
  cursor: crosshair;
}

/*
 * Selection outline. Lives inside the element's own <g> in element-local
 * coordinates, is created lazily (first selection), and is toggled by the
 * \`selected\` class — never removed, so re-selecting costs nothing.
 *
 * There is deliberately NO hover rule: in bpmn-js hovering a shape adds a class and
 * changes nothing at all on screen, and the canvas matches that by never adding the
 * class in the first place. The only hover that renders is on a connection, where
 * it reveals bendpoints (see below).
 */
.sf-canvas .sf-outline {
  fill: none;
  stroke: none;
  stroke-width: 2px;
  shape-rendering: geometricPrecision;
  visibility: hidden;
  pointer-events: none;
}

.sf-canvas .sf-shape.selected > .sf-outline,
.sf-canvas .sf-external-label.selected > .sf-outline {
  visibility: visible;
  stroke: var(--sf-element-selected-outline-stroke-color);
}

/* A selected connection shows no outline; its selection IS its bendpoints. */
.sf-canvas .sf-connection.selected > .sf-outline {
  display: none;
}

/* Two or more selected — and every element the lasso has enclosed so far — drop to
   the secondary blue. */
.sf-canvas.sf-multi-select .sf-shape.selected > .sf-outline,
.sf-canvas.sf-multi-select .sf-external-label.selected > .sf-outline,
.sf-canvas.sf-dragging-active-lasso .sf-shape.selected > .sf-outline,
.sf-canvas.sf-dragging-active-lasso .sf-external-label.selected > .sf-outline {
  stroke: var(--sf-element-selected-outline-secondary-stroke-color);
}

/* A shape hides its own outline while it is the one being dragged or resized. */
.sf-canvas .sf-shape.sf-resizing > .sf-outline,
.sf-canvas .sf-dragger > .sf-outline {
  visibility: hidden !important;
}

/*
 * Resize handles — eight 8x8 chips on the element's own bounds.
 */
.sf-canvas .sf-resizer-visual {
  fill: var(--sf-resizer-fill-color);
  stroke: var(--sf-resizer-stroke-color);
  stroke-width: 1px;
  shape-rendering: geometricPrecision;
}

.sf-canvas .sf-resizer-hit {
  fill: none;
  pointer-events: all;
}

.sf-canvas .sf-resizer-n,
.sf-canvas .sf-resizer-s {
  cursor: ns-resize;
}

.sf-canvas .sf-resizer-e,
.sf-canvas .sf-resizer-w {
  cursor: ew-resize;
}

.sf-canvas .sf-resizer-nw,
.sf-canvas .sf-resizer-se {
  cursor: nwse-resize;
}

.sf-canvas .sf-resizer-ne,
.sf-canvas .sf-resizer-sw {
  cursor: nesw-resize;
}

/*
 * Bendpoints — drawn for a connection that is selected OR hovered.
 */
.sf-canvas .sf-bendpoint-visual {
  fill: var(--sf-bendpoint-fill-color);
  stroke: var(--sf-bendpoint-stroke-color);
  stroke-width: 1px;
  stroke-opacity: 1;
  shape-rendering: geometricPrecision;
}

.sf-canvas .sf-bendpoint-hit {
  fill: none;
  pointer-events: all;
  cursor: move;
}

/*
 * Dragging. The element being dragged becomes the GHOST (blue outline only, label
 * included) and a frozen copy of where it came from stays behind at 0.3.
 */
.sf-canvas .sf-dragger * {
  fill: none !important;
  stroke: var(--sf-element-dragger-color) !important;
}

.sf-canvas .sf-dragger text,
.sf-canvas .sf-dragger tspan {
  fill: var(--sf-element-dragger-color) !important;
  stroke: none !important;
}

.sf-canvas .sf-dragging,
.sf-canvas .sf-dragging > * {
  opacity: var(--sf-element-dragging-opacity) !important;
  pointer-events: none !important;
}

/*
 * Snap lines and the lasso rectangle.
 */
.sf-canvas .sf-snap-line {
  stroke: var(--sf-snap-line-stroke-color);
  stroke-width: 2px;
  stroke-linecap: round;
  pointer-events: none;
}

.sf-canvas .sf-lasso-overlay {
  fill: var(--sf-lasso-fill-color);
  stroke: var(--sf-lasso-stroke-color);
  stroke-width: 2px;
  shape-rendering: geometricPrecision;
  pointer-events: none;
}

/*
 * Drop feedback for a palette create (parity spec §7 "Drop feedback").
 *
 * The element under the pointer is tinted rather than outlined: pale grey when it
 * would accept the drop (\`new-parent\` in diagram-js — a container, or a sequence
 * flow the shape would be inserted into) and pale red when it would refuse, where
 * the cursor also turns to \`not-allowed\` over the target and everything inside it.
 * The ghost itself stays blue in both cases, exactly as bpmn-js leaves it.
 *
 * The tinted node is the element's own first visual — the shape body, never the
 * selection outline, which may already be sitting in front of it.
 */
.sf-canvas.sf-drag-active {
  cursor: grabbing;
}

.sf-canvas .sf-new-parent > :first-child:not(.sf-outline),
.sf-canvas .sf-new-parent > .sf-outline + * {
  fill: var(--sf-drop-ok-fill-color);
}

.sf-canvas .sf-drop-not-ok > :first-child:not(.sf-outline),
.sf-canvas .sf-drop-not-ok > .sf-outline + * {
  fill: var(--sf-drop-not-ok-fill-color);
}

.sf-canvas .sf-drop-not-ok,
.sf-canvas .sf-drop-not-ok * {
  cursor: not-allowed !important;
}

/*
 * While the inline editor is open on an element, that element's drawn LABEL steps
 * aside — otherwise the transparent internal editor would show the old text through
 * the one being typed. Only the label goes: a gateway keeps its ×, a task its icon
 * and markers. This is diagram-js's own "djs-label-hidden .djs-label" rule, one for one.
 */
.sf-canvas .sf-label-hidden .sf-label {
  display: none;
}

/*
 * The inline (direct) label editor — parity spec §5.
 *
 * It is an HTML overlay in the canvas CONTAINER, not inside the \`<svg>\`, so its
 * rules are unprefixed and its tokens are declared on the element itself. Two
 * variants, exactly as in bpmn-js:
 *
 * - internal (a task's own label): no chrome at all — transparent, borderless, the
 *   text simply becomes editable where it is drawn;
 * - external (the caption under an event/gateway/data shape): a small white box
 *   with a 1px #ccc border, sized tight to the text.
 *
 * Geometry (position/size) and the zoom-dependent font size stay inline: they are
 * computed per session from the viewport, and nothing else may own them.
 */
.sf-label-editor {
  /* Pure black, deliberately NOT the #22242A the renderer strokes labels with:
     parity spec §5 measured rgb(0,0,0) in both editor variants. */
  --sf-label-editor-color: #000000;
  --sf-label-editor-external-fill: hsl(0, 0%, 100%);
  --sf-label-editor-external-stroke-color: #ccc;

  position: absolute;
  z-index: 10;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden;
  background: transparent;
  box-shadow: none;
  color: var(--sf-label-editor-color);
  text-align: center;
  line-height: 1.2;
  white-space: normal;
  word-break: normal;
}

.sf-label-editor-internal {
  padding: 7px 5px;
}

.sf-label-editor-external {
  background: var(--sf-label-editor-external-fill);
  border: 1px solid var(--sf-label-editor-external-stroke-color);
  border-radius: 0;
}
`;

/**
 * Ensure {@link CANVAS_CSS} is present in `doc` (idempotent — keyed on
 * {@link CANVAS_STYLE_ID}). Called from the {@link Canvas} constructor so the
 * package stays drop-in: importing it from TypeScript is enough, no CSS entry in
 * the host's bundler. A document with no `<head>` (a bare XML DOM) is skipped
 * rather than thrown on — the sheet is chrome, and a headless render needs none of
 * it. Returns the `<style>` element when one is in place.
 */
export function injectCanvasStyles(doc: Document): HTMLStyleElement | undefined {
  const existing = doc.getElementById(CANVAS_STYLE_ID);
  if (existing) return existing as HTMLStyleElement;
  const head = doc.head ?? doc.documentElement;
  if (!head || typeof doc.createElement !== 'function') return undefined;
  const style = doc.createElement('style');
  style.id = CANVAS_STYLE_ID;
  style.textContent = CANVAS_CSS;
  head.appendChild(style);
  return style;
}
