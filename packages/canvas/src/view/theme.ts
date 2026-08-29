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
 * — so a value can be checked against the parity spec by reading one file, and the
 * name it is checked under is the one the reference editor used for it.
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
 * transform. Chrome therefore scales with zoom.
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
  /* A connection re-routing under a shape that is being moved. Pale gray, NOT the
     dragger blue: \`edge-videos/dnd/frame_05\` keeps the blue for the one thing the
     cursor is carrying and lets its flows fade into the background. */
  --sf-element-dragging-edge-color: hsl(0, 0%, 80%);

  --sf-resizer-fill-color: var(--sf-color-blue-205-100-45);
  --sf-resizer-stroke-color: var(--sf-canvas-fill-color);

  --sf-bendpoint-fill-color: var(--sf-color-blue-205-100-45);
  --sf-bendpoint-stroke-color: var(--sf-canvas-fill-color);
  /* The segment grip is DARK, not blue — see the rule below. Same ink the renderer
     draws an uncoloured element with (\`render/renderer.ts\` DEFAULT_STROKE). */
  --sf-segment-grip-fill-color: #22242A;

  /* A caption's chrome: the inert chips around it and the dashed leader back to the
     element it names (\`edge-videos/labels/frame_08\`) are both the selection blue. */
  --sf-label-chip-fill-color: var(--sf-color-blue-205-100-50);
  --sf-label-chip-stroke-color: var(--sf-canvas-fill-color);
  --sf-label-leader-stroke-color: var(--sf-element-selected-outline-stroke-color);

  --sf-snap-line-stroke-color: hsla(205, 100%, 45%, 0.3);

  --sf-lasso-fill-color: hsla(205, 100%, 50%, 0.15);
  --sf-lasso-stroke-color: var(--sf-element-selected-outline-stroke-color);

  --sf-drop-ok-fill-color: hsl(225, 10%, 97%);
  --sf-drop-not-ok-fill-color: hsl(360, 100%, 97%);

  /* The red a refused connect ghost turns — diagram-js's own rejection ink. */
  --sf-connect-preview-rejected-stroke-color: hsl(4, 90%, 58%);

  /* Empty canvas is a pan surface (parity spec §10), so the root reads as one:
     \`grab\` at rest, \`grabbing\` while it is actually being dragged — diagram-js's
     \`djs-cursor-grab\` / \`djs-cursor-grabbing\`, expressed as root state classes. */
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

/* …but only over the canvas itself: a grab hand over a shape would promise a pan,
   and what a press on a shape actually starts is a MOVE. \`edge-videos/dnd/frame_03\`
   shows the ✥ over the task body, so that is what a shape reads as (parity spec
   addendum 2 §4). A connection keeps the plain arrow — its own gestures announce
   themselves through the bendpoint and segment-grip cursors. */
.sf-canvas .sf-connection {
  cursor: default;
}

.sf-canvas .sf-shape:not(.sf-external-label) {
  cursor: move;
}

/* A caption travels on its own (parity spec addendum 3 §2), so it reads as movable
   too — including an EDGE's caption, whose \`<g>\` sits inside a \`.sf-connection\`
   that has just said \`default\` (\`edge-videos/labels/frame_06\` shows the ✥ over
   the label while the flow under it keeps the arrow). */
.sf-canvas .sf-external-label {
  cursor: move;
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
 * Label chrome (parity spec addendum 3 §3, \`edge-videos/labels/frame_08\`).
 *
 * The LEADER is the piece the reference makes a point of: a blue dashed line from a
 * selected — or dragged — caption to the element it names, so a label sitting away
 * from its flow still visibly belongs to it. It is drawn from the selection layer in
 * diagram coordinates and is inert to the pointer, like every other overlay.
 *
 * The CHIPS are decoration and nothing more. A label is not resizable here (there is
 * no label-resize mutation for the writeback to commit), so they carry no
 * \`data-handle\`, take no pointer events, and start no gesture — they exist because
 * the reference draws them and their absence read as "this is not really selected".
 */
.sf-canvas .sf-label-leader {
  stroke: var(--sf-label-leader-stroke-color);
  stroke-width: 1px;
  stroke-dasharray: 4, 4;
  fill: none;
  pointer-events: none;
  shape-rendering: geometricPrecision;
}

.sf-canvas .sf-label-chip {
  fill: var(--sf-label-chip-fill-color);
  stroke: var(--sf-label-chip-stroke-color);
  stroke-width: 1px;
  pointer-events: none;
  shape-rendering: geometricPrecision;
}

/*
 * Segment-move grips — the one straight run the pointer hovers (parity spec §2),
 * drawn alongside the bendpoints of a selected OR hovered connection, following
 * the pointer along the run.
 *
 * These are the one piece of edge chrome that is NOT diagram-js blue: the reference
 * (\`edge-videos/v2/frame_10\`) paints the double triangle in the element stroke
 * colour, dark, so the grip reads as part of the line it moves rather than as a
 * point on it. The cursor names the one axis the run can travel.
 */
.sf-canvas .sf-segment-grip-visual {
  fill: var(--sf-segment-grip-fill-color);
  stroke: none;
  shape-rendering: geometricPrecision;
}

.sf-canvas .sf-segment-grip-hit {
  fill: none;
  pointer-events: all;
}

.sf-canvas .sf-segment-grip-ns {
  cursor: ns-resize;
}

.sf-canvas .sf-segment-grip-ew {
  cursor: ew-resize;
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
 * A connection attached to what is moving. It is NOT part of the ghost: it stays a
 * real, live, re-routing line (\`interaction/drag.ts\` re-routes it on every frame)
 * and simply fades to gray while the move is in flight, so the eye follows the blue
 * silhouette and not the rubber-banding flows (\`edge-videos/dnd/frame_01\`, \`f05\`).
 */
.sf-canvas .sf-dragging-edge * {
  stroke: var(--sf-element-dragging-edge-color) !important;
}

.sf-canvas .sf-dragging-edge text,
.sf-canvas .sf-dragging-edge tspan {
  fill: var(--sf-element-dragging-edge-color) !important;
  stroke: none !important;
}

/*
 * Both gesture previews are pictures of the future, not things to click: the context
 * pad's append ghost (parity spec addendum 5 — the element a pad entry would create
 * plus the connection that would reach it) and the live connect / reconnect rubber
 * band. Neither may take a hit, or the drop would land on the promise instead of on
 * the shape underneath it.
 */
.sf-canvas .sf-append-preview,
.sf-canvas .sf-connect-preview {
  pointer-events: none;
}

/*
 * A live connect / reconnect gesture publishes its verdict on the root
 * (\`interaction/connect.ts\`), and the cursor is where the user reads it: the ∅ of
 * \`edge-videos/v2/frame_02\` shows both over a shape the rules refuse AND over empty
 * space, where the drag simply has nowhere to land yet. Only \`ok\` — over a target
 * that would take the drop — lets the cursor go.
 */
.sf-canvas[data-connect-status="pending"],
.sf-canvas[data-connect-status="pending"] *,
.sf-canvas[data-connect-status="rejected"],
.sf-canvas[data-connect-status="rejected"] * {
  cursor: not-allowed !important;
}

.sf-canvas[data-connect-status="ok"],
.sf-canvas[data-connect-status="ok"] * {
  cursor: crosshair !important;
}

/*
 * …and the canvas itself washes pale red for as long as the drop would be refused.
 * \`edge-videos/v2/frame_02\` tints the WHOLE surface, not just the shape under the
 * pointer, which is what makes a rejected drag readable when the pointer is out over
 * empty space with nothing to tint.
 */
.sf-canvas[data-connect-status="pending"],
.sf-canvas[data-connect-status="rejected"] {
  background-color: var(--sf-drop-not-ok-fill-color);
}

/*
 * The live connect / reconnect ghost line. Painted from the gesture's own verdict —
 * blue while it can still land, red once the shape under the pointer has refused —
 * so the preview blue is the one \`--sf-element-dragger-color\` token every other
 * piece of drag chrome uses (parity spec §5: rgb(0,149,255)) instead of a second
 * hard-coded blue drifting away from it. \`interaction/connect.ts\` sets only the
 * geometry, the dash and the arrowhead.
 */
.sf-canvas .sf-connect-preview .sf-connect-preview-line {
  stroke: var(--sf-element-dragger-color);
}

.sf-canvas .sf-connect-preview[data-status="rejected"] .sf-connect-preview-line {
  stroke: var(--sf-connect-preview-rejected-stroke-color);
}

.sf-canvas .sf-append-preview-line {
  fill: none;
  stroke: var(--sf-element-dragger-color);
  stroke-width: 2px;
  stroke-linejoin: round;
  stroke-linecap: round;
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
 * A CONNECT drag paints the same accepting tint under its own marker,
 * \`sf-connect-ok\` — ux-spec §4/§7 keeps the two states apart because they mean
 * different things ("this would contain the shape" vs "this would take the flow"),
 * even though the reference paints them the same.
 *
 * The tinted node is the element's own first visual — the shape body, never the
 * selection outline, which may already be sitting in front of it.
 */
.sf-canvas.sf-drag-active {
  cursor: grabbing;
}

.sf-canvas .sf-new-parent > :first-child:not(.sf-outline),
.sf-canvas .sf-new-parent > .sf-outline + *,
.sf-canvas .sf-connect-ok > :first-child:not(.sf-outline),
.sf-canvas .sf-connect-ok > .sf-outline + * {
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
  /* These three tokens stay HERE rather than joining the palette on \`.sf-canvas\`:
     the editor is a sibling of the \`<svg>\`, not a descendant of it, so a custom
     property declared there would not reach it. Same reason its rules are unprefixed.

     Pure black, deliberately NOT the #22242A the renderer strokes labels with:
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
