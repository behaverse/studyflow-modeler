/**
 * Icon registry + drawing (design §3 `render/icons.ts`, §5 icon-source risk).
 *
 * The modeler resolves icon *classes* (`i-bootstrap-…`) through a Tailwind 4 +
 * iconify build pipeline. The canvas must NOT inherit that toolchain, so for P1
 * `drawIcon` renders a simple placeholder (a small glyph box) unless an
 * {@link IconResolver} is injected that maps an icon key to inline SVG path data
 * — the presentation-agnostic option (a) from design §5. Inline path glyphs that
 * ship with the document (`SVG_ICON_PATHS`) are drawn directly via
 * {@link drawSvgPaths} (ported from `draw/utils.ts`). Geometry, not icon fidelity,
 * is the P1 goal.
 */

import type { ModdleObject } from '@canvas/model/scene.ts';
import { append, create, createHtml } from '@canvas/render/svg.ts';

/** An inline SVG glyph: a viewBox and its path `d` strings. */
export interface SvgIconDef {
  viewBox: string;
  paths: string[];
}

/**
 * A resolved glyph handed over as raw SVG **markup** — the shape an iconify body
 * arrives in (`{ content, viewBox }`, `export/iconSource.ts`). Drawing it produces a
 * real nested `<svg>`, which is what makes an exported document self-contained: the
 * `foreignObject` + CSS-class form below only paints where the app's icon toolchain
 * is loaded (parity addendum 6 §1).
 */
export interface InlineSvgIconDef {
  viewBox: string;
  content: string;
}

/**
 * A CSS-class icon: the app's own glyph pipeline (Tailwind 4 + iconify in the
 * modeler) resolves the class at paint time, so the canvas only has to mount a
 * `<div>` carrying it inside a `<foreignObject>`.
 *
 * Since addendum 6 this is the **placeholder** form, not the export form: the app
 * pre-resolves its classes to {@link InlineSvgIconDef} bodies and re-draws, so the
 * `foreignObject` only survives for a glyph that has not arrived (or cannot). The
 * `data-icon-class` / `data-icon-color` attributes stay because they are how a
 * not-yet-resolved icon is still identifiable in the DOM.
 */
export interface CssIconDef {
  cssClass: string;
}

/** What an {@link IconResolver} may return. */
export type IconDef = SvgIconDef | CssIconDef | InlineSvgIconDef;

/**
 * Injected icon source: given an icon key (a marker name such as `'loop'`, or a
 * BPMN type's local name such as `'UserTask'`) returns either inline SVG paths or
 * a CSS class to mount. Kept out of the canvas core so the app owns its icon
 * pipeline.
 *
 * Two ways of answering "nothing", and they mean different things:
 *
 * - `undefined` — *I don't know this key.* Fall back to the placeholder box, which
 *   is what makes a resolver-less canvas still show that a glyph belongs there.
 * - `null` — *this key HAS no glyph.* Draw nothing at all. A `bpmn:SubProcess` or a
 *   `bpmn:CallActivity` carries no top-left type icon in BPMN (its marker and its
 *   border say what it is), and a placeholder box in that corner is not a
 *   loading state — it is a permanent, exported lie.
 */
export type IconResolver = (
  iconKey: string,
  businessObject?: ModdleObject,
) => IconDef | null | undefined;

function isCssIcon(def: IconDef): def is CssIconDef {
  return typeof (def as CssIconDef).cssClass === 'string';
}

function isInlineIcon(def: IconDef): def is InlineSvgIconDef {
  return typeof (def as InlineSvgIconDef).content === 'string';
}

/**
 * Inline path glyphs bundled with the document (ported from `draw/icons.ts`).
 * These survive SVG export and need no external toolchain.
 */
export const SVG_ICON_PATHS: Record<string, SvgIconDef> = {
  'bids-dataset-icon': {
    viewBox: '0 0 135 43.461',
    paths: [
      'm29.99,21.107l-0.961,-0.458l0.814,-0.702a10.755,10.755 0 0 0 3.827,-8.452c0,-6.731 -4.513,-10.019 -13.782,-10.019l-18.051,0l0,40.517l17.542,0c5.843,0 15.644,-1.525 15.644,-11.747c0.013,-4.535 -1.638,-7.519 -5.032,-9.138m-11.673,-12.353c5.048,0 7.106,1.404 7.106,4.836c0,1.282 -0.616,4.231 -6.33,4.231l-9.388,0l0,-6.919l-4.993,-2.148l13.605,0zm0.116,25.961l-8.727,0l0,-9.903l9.208,0c3.872,0 7.83,0.58 7.83,4.891c0.007,4.398 -3.993,5 -8.311,5l0,0.012z',
      'm42.724,1.476l7.875,0l0,40.506l-7.875,0l0,-40.506z',
      'm72.676,1.476l-12.593,0l0,40.516l11.692,0c8.195,0 14.356,-1.949 18.311,-5.789s6.009,-8.866 6.009,-15.003c0.003,-7.372 -3.039,-19.725 -23.42,-19.725m-0.122,33.227l-4.59,0l0,-23.627l-5.638,-2.321l10.237,0c10.202,0 15.384,4.167 15.384,12.436c-0.019,8.971 -5.192,13.513 -15.394,13.513',
      'm133.16,30.351a10.255,10.255 0 0 0 -1.602,-5.715c-2.144,-3.132 -5.324,-4.394 -9.58,-5.833c-1.509,-0.513 -3.007,-0.914 -4.455,-1.298c-4.128,-1.1 -7.692,-2.048 -7.692,-5.055c0,-2.122 1.211,-4.654 6.987,-4.654c4.003,0 7.465,1.548 10.577,4.734l5.227,-5.058c-3.75,-4.676 -8.817,-6.952 -15.465,-6.952c-4.596,0 -8.372,1.211 -11.218,3.606s-4.301,5.128 -4.301,8.442c0,7.138 5.375,9.766 11.18,11.539c1.417,0.477 2.734,0.836 4.007,1.186c2.414,0.664 4.487,1.234 6.116,2.311c1.308,0.872 2.058,2.134 2.058,3.465s-0.705,2.513 -1.923,3.333c-1.164,0.84 -2.904,1.253 -5.301,1.253c-5.009,0 -9.542,-2.481 -12.548,-6.843l-5.718,4.763c3.356,5.961 10.064,9.366 18.507,9.366c4.384,0 7.936,-1.199 10.862,-3.667c2.84,-2.352 4.285,-5.352 4.285,-8.923',
    ],
  },
};

/**
 * Activity/subprocess markers (design §2). The modeler maps these keys to iconify
 * classes; the canvas maps them to a compact placeholder glyph so a marker is
 * still visible without the icon toolchain.
 */
export const MARKER_ICONS: Record<string, string> = {
  subprocess: '⊞',
  adhoc: '~',
  parallel: '‖',
  sequential: '≣',
  loop: '↻',
  compensation: '⏪',
  checklist: '☑',
  function: 'ƒ',
};

/** Font used by placeholder glyphs (a plain system stack; no bundled font). */
const PLACEHOLDER_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * Draw `iconKey` into `container` at `(x, y)` sized `size`. Prefers, in order: an
 * injected {@link IconResolver}, a bundled {@link SVG_ICON_PATHS} glyph, then a
 * placeholder (a subtle box + the marker glyph or the key's initial). Returns the
 * appended element, or `undefined` for an empty key.
 */
export function drawIcon(
  container: SVGElement,
  iconKey: string | undefined,
  x = 4,
  y = 4,
  size = 24,
  color = '#000000',
  resolver?: IconResolver,
  businessObject?: ModdleObject,
): SVGElement | undefined {
  if (!iconKey) return undefined;

  const answer = resolver?.(iconKey, businessObject);
  // An explicit `null` is the resolver saying the key has no glyph — not a miss to
  // be papered over with a placeholder, and not a reason to consult the bundled
  // paths either.
  if (answer === null) return undefined;

  const resolved: IconDef | undefined = answer ?? SVG_ICON_PATHS[iconKey];
  if (resolved) {
    if (isCssIcon(resolved)) return drawCssIcon(container, resolved.cssClass, x, y, size, color, iconKey);
    if (isInlineIcon(resolved)) return drawInlineSvgIcon(container, resolved, x, y, size, color, iconKey);
    return drawSvgPaths(container, resolved, x, y, size, size, color, iconKey);
  }
  return drawPlaceholder(container, iconKey, x, y, size, color);
}

/**
 * Mount a resolved glyph as a real nested `<svg>` — the form the SVG exporter used
 * to substitute for the `foreignObject` at export time (`embedIconsInSvg`), now drawn
 * straight into the scene so an export needs no substitution at all.
 *
 * `currentColor` inside the body is rewritten to the element's colour, exactly as
 * that exporter did, and `stroke="none"` on the wrapper keeps the glyph from
 * inheriting the shape's outline (a body that strokes itself sets its own).
 *
 * `iconKey` is stamped as `data-icon-key` so a resolved glyph stays identifiable in
 * the DOM — the identity the `foreignObject` form carries as `data-icon-class` and
 * the placeholder carries as `data-icon-key`. Marker glyphs that differ only by a
 * transform (`parallel` vs `sequential` share their path `d` and differ solely by a
 * `rotate(90 …)` wrapper) are otherwise indistinguishable to a selector.
 */
export function drawInlineSvgIcon(
  container: SVGElement,
  def: InlineSvgIconDef,
  x: number,
  y: number,
  size: number,
  color: string,
  iconKey?: string,
): SVGElement {
  const svg = create('svg', {
    x, y, width: size, height: size,
    class: 'sf-icon',
    viewBox: def.viewBox,
    stroke: 'none',
    color: color || null,
    'data-icon-key': iconKey ?? null,
  });
  svg.innerHTML = color ? def.content.replace(/currentColor/g, color) : def.content;
  append(container, svg);
  return svg;
}

/**
 * Mount a CSS-class glyph inside a `<foreignObject>` — the shape the modeler's
 * icon sheet expects (`packages/modeler/src/draw/icons.ts`), so one class name
 * styles a glyph the same in the canvas and in an exported SVG.
 */
export function drawCssIcon(
  container: SVGElement,
  cssClass: string,
  x: number,
  y: number,
  size: number,
  color: string,
  iconKey?: string,
): SVGElement {
  const foreignObject = create('foreignObject', {
    x, y, width: size, height: size,
    class: 'icon-container',
    color,
    'data-icon-key': iconKey ?? null,
  });
  const div = createHtml('div');
  div.className = cssClass;
  Object.assign(div.style, {
    width: `${size}px`,
    height: `${size}px`,
    fontSize: `${size}px`,
    color: color || 'currentColor',
    // Block, not inline: an inline box leaves a baseline gap inside the foreignObject.
    display: 'block',
    lineHeight: '1',
    verticalAlign: 'top',
    margin: '0',
    padding: '0',
    boxSizing: 'border-box',
  });
  div.setAttribute('data-icon-class', cssClass);
  div.setAttribute('data-icon-color', color || '');
  foreignObject.appendChild(div);
  append(container, foreignObject);
  return foreignObject;
}

/** A small labelled placeholder box standing in for an unresolved icon. */
function drawPlaceholder(
  container: SVGElement,
  iconKey: string,
  x: number,
  y: number,
  size: number,
  color: string,
): SVGElement {
  const g = create('g', { class: 'sf-icon-placeholder', 'data-icon-key': iconKey });
  append(g, create('rect', {
    x, y, width: size, height: size,
    rx: 3, ry: 3,
    fill: 'none',
    stroke: color,
    'stroke-width': 1,
    opacity: 0.4,
  }));
  const glyph = MARKER_ICONS[iconKey] ?? glyphFor(iconKey);
  const text = create('text', {
    x: x + size / 2,
    y: y + size / 2,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': PLACEHOLDER_FONT,
    'font-size': Math.max(8, size * 0.6),
    fill: color,
    'stroke-width': 0,
  });
  text.textContent = glyph;
  append(g, text);
  append(container, g);
  return g;
}

/** First meaningful character of an icon key, for the placeholder glyph. */
function glyphFor(iconKey: string): string {
  const cleaned = iconKey.replace(/^i-[a-z]+-/i, '').replace(/[^a-z0-9]/gi, '');
  return (cleaned[0] ?? '?').toUpperCase();
}

/**
 * Draw inline SVG paths scaled to fit `width × height` at `(x, y)` (ported from
 * `draw/utils.ts` `drawSvgPaths`); these survive SVG export.
 */
export function drawSvgPaths(
  container: SVGElement,
  iconDef: SvgIconDef,
  x: number,
  y: number,
  width: number,
  height: number,
  fillColor: string,
  iconKey?: string,
): SVGElement {
  const [, , vbW, vbH] = iconDef.viewBox.split(/\s+/).map(Number);
  const g = create('g', { 'data-icon-key': iconKey ?? null });
  g.setAttribute('transform', `translate(${x}, ${y})`);

  const inner = create('g');
  const scale = Math.min(width / vbW, height / vbH);
  const dx = (width - vbW * scale) / 2;
  const dy = (height - vbH * scale) / 2;
  inner.setAttribute('transform', `translate(${dx}, ${dy}) scale(${scale})`);

  for (const d of iconDef.paths) {
    append(inner, create('path', { d, fill: fillColor }));
  }
  append(g, inner);
  append(container, g);
  return g;
}

/**
 * Draw a short text glyph (e.g. a behaverse scene abbreviation) centred in an icon
 * box — a self-contained port of `draw/utils.ts` `drawIconText`, using a plain
 * font stack instead of the modeler's bundled family.
 */
export function drawIconText(
  container: SVGElement,
  marker: string | undefined,
  color: string,
  x = 4,
  y = 4,
  size = 24,
): SVGElement | undefined {
  if (!marker) return undefined;
  const glyph = marker.length > 4 ? marker.slice(0, 4) : marker;
  const fontSize = glyph.length <= 2 ? 11 : glyph.length === 3 ? 10 : 8;
  const text = create('text', {
    x: x + size / 2,
    y: y + size / 2,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': PLACEHOLDER_FONT,
    'font-size': fontSize,
    'font-weight': 'bold',
    fill: color,
    'stroke-width': 0,
  });
  text.textContent = glyph;
  append(container, text);
  return text;
}

/** `createHtml` re-export kept so a future resolver can build foreignObject icons. */
export { createHtml };
