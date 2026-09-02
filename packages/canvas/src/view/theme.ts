/** The look: the ink the renderer paints with, and the stylesheet for editor chrome. */

/** Colours drawn as attributes, so an exported SVG carries its own paint. */
export const INK = {
  stroke: '#44403c',
  fill: '#ffffff',
  text: '#1c1917',
  muted: '#78716c',
  accent: '#c028b0',
} as const;

export const CANVAS_STYLE_ID = 'sf-canvas-style';

export const CANVAS_CSS = `
.sf-canvas {
  --sf-accent: ${INK.accent};
  --sf-accent-soft: rgba(192, 40, 176, 0.1);
  --sf-danger: #dc2626;
  --sf-danger-soft: rgba(220, 38, 38, 0.08);
  --sf-canvas-fill-color: #faf9f6;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.sf-canvas .sf-shape, .sf-canvas .sf-external-label { cursor: move; }
.sf-canvas .sf-connection { cursor: default; }
.sf-canvas.sf-panning, .sf-canvas.sf-panning * { cursor: grabbing; }
.sf-canvas.sf-drag-active { cursor: grabbing; }

.sf-canvas .sf-outline {
  fill: none;
  stroke: none;
  stroke-width: 1.5px;
  visibility: hidden;
  pointer-events: none;
}
.sf-canvas .selected > .sf-outline { visibility: visible; stroke: var(--sf-accent); }
.sf-canvas .sf-resizing > .sf-outline, .sf-canvas .sf-editing > .sf-outline { visibility: hidden; }
.sf-canvas .sf-connection.selected .sf-connection-line { stroke: var(--sf-accent); }

.sf-canvas .sf-handle-visual { fill: #ffffff; stroke: var(--sf-accent); stroke-width: 1.5px; }
.sf-canvas .sf-handle-hit { fill: none; pointer-events: all; }
.sf-canvas .sf-handle-nw, .sf-canvas .sf-handle-se { cursor: nwse-resize; }
.sf-canvas .sf-handle-ne, .sf-canvas .sf-handle-sw { cursor: nesw-resize; }

.sf-canvas .sf-bendpoint-visual { fill: #ffffff; stroke: var(--sf-accent); stroke-width: 1.5px; }
.sf-canvas .sf-bendpoint-hit { fill: none; pointer-events: all; cursor: move; }

.sf-canvas .sf-ghost { opacity: 0.55; pointer-events: none; }
.sf-canvas .sf-preview { pointer-events: none; }
.sf-canvas .sf-preview-line { fill: none; stroke: var(--sf-accent); stroke-width: 1.5px; stroke-linejoin: round; stroke-linecap: round; }
.sf-canvas .sf-connect-preview[data-status="rejected"] .sf-preview-line { stroke: var(--sf-danger); }
.sf-canvas[data-connect-status="rejected"], .sf-canvas[data-connect-status="rejected"] *,
.sf-canvas[data-connect-status="pending"], .sf-canvas[data-connect-status="pending"] * { cursor: not-allowed; }
.sf-canvas[data-connect-status="rejected"], .sf-canvas[data-connect-status="pending"] { background-color: var(--sf-danger-soft); }
.sf-canvas[data-connect-status="ok"], .sf-canvas[data-connect-status="ok"] * { cursor: crosshair; }

.sf-canvas .sf-snap-line { stroke: var(--sf-accent); stroke-opacity: 0.5; stroke-width: 1px; pointer-events: none; }
.sf-canvas .sf-marquee { fill: var(--sf-accent-soft); stroke: var(--sf-accent); stroke-width: 1px; pointer-events: none; }

.sf-canvas .sf-drop-ok > :first-child:not(.sf-outline),
.sf-canvas .sf-drop-ok > .sf-outline + * { fill: var(--sf-accent-soft); }
.sf-canvas .sf-drop-not-ok > :first-child:not(.sf-outline),
.sf-canvas .sf-drop-not-ok > .sf-outline + * { fill: var(--sf-danger-soft); }
.sf-canvas .sf-drop-not-ok, .sf-canvas .sf-drop-not-ok * { cursor: not-allowed; }

.sf-canvas .sf-label-hidden .sf-label { display: none; }

.sf-label-editor {
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
  color: ${INK.text};
  text-align: center;
  line-height: 1.2;
  white-space: normal;
  word-break: normal;
}
.sf-label-editor-internal { padding: 6px 4px; }
.sf-label-editor-external {
  background: #ffffff;
  border: 1px solid #d6d3d1;
  border-radius: 4px;
  padding: 1px 2px;
}
`;

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
