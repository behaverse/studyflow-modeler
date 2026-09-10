/**
 * Icons. The host resolves a key (a marker name, a BPMN local name) to a glyph:
 * inline SVG paths, an SVG body, or a CSS class the host's icon pipeline paints.
 */

import type { ModdleObject } from '@canvas/model/scene.ts';
import { append, create, createHtml, ownerDocument } from '@canvas/render/svg.ts';

export interface SvgIconDef {
  viewBox: string;
  paths: string[];
}

/** Raw SVG markup, drawn as a nested `<svg>` so an export is self-contained. */
export interface InlineSvgIconDef {
  viewBox: string;
  content: string;
}

/** A class the host's stylesheet paints; drawn inline when the stylesheet carries its glyph, else as a placeholder. */
export interface CssIconDef {
  cssClass: string;
}

export type IconDef = SvgIconDef | CssIconDef | InlineSvgIconDef;

/** `undefined`: unknown key, draw a placeholder. `null`: this key has no glyph, draw nothing. */
export type IconResolver = (iconKey: string, businessObject?: ModdleObject) => IconDef | null | undefined;

function isCssIcon(def: IconDef): def is CssIconDef {
  return typeof (def as CssIconDef).cssClass === 'string';
}

function isInlineIcon(def: IconDef): def is InlineSvgIconDef {
  return typeof (def as InlineSvgIconDef).content === 'string';
}

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

/** Placeholder glyphs for the activity markers, when no resolver answers. */
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

const PLACEHOLDER_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** Draw `iconKey` at `(x, y)` sized `size`: resolver first, bundled paths next, placeholder last. */
export function drawIcon(
  container: SVGElement,
  iconKey: string | undefined,
  x: number,
  y: number,
  size: number,
  color: string,
  resolver?: IconResolver,
  businessObject?: ModdleObject,
): SVGElement | undefined {
  if (!iconKey) return undefined;
  const answer = resolver?.(iconKey, businessObject);
  if (answer === null) return undefined;
  const resolved: IconDef | undefined = answer ?? SVG_ICON_PATHS[iconKey];
  if (resolved) {
    if (isCssIcon(resolved)) {
      const inline = stylesheetIcon(resolved.cssClass);
      return inline
        ? drawInlineSvgIcon(container, inline, x, y, size, color, iconKey)
        : drawCssIcon(container, resolved.cssClass, x, y, size, color, iconKey);
    }
    if (isInlineIcon(resolved)) return drawInlineSvgIcon(container, resolved, x, y, size, color, iconKey);
    return drawSvgPaths(container, resolved, x, y, size, size, color, iconKey);
  }
  return drawPlaceholder(container, iconKey, x, y, size, color);
}

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
    x, y, width: size, height: size, class: 'sf-icon', viewBox: def.viewBox, stroke: 'none',
    color: color || null, 'data-icon-key': iconKey ?? null,
  });
  svg.innerHTML = color ? def.content.replace(/currentColor/g, color) : def.content;
  append(container, svg);
  return svg;
}

/** Quarter-turn rotations expressed as Tailwind utility classes on an icon. */
const ROTATIONS: Record<string, number> = {
  'rotate-90': 90,
  'rotate-180': 180,
  'rotate-270': 270,
  '-rotate-90': -90,
};

const STYLESHEET_ICONS = new Map<string, InlineSvgIconDef | undefined>();

/**
 * The glyph an iconify class paints, read straight out of the host's stylesheet: the
 * Tailwind iconify plugin compiles every icon into a `--svg` data URI on its class, so
 * the body is available synchronously and the drawn scene carries real paths (an
 * export is then self-contained, and a `foreignObject` never taints the PNG canvas).
 * `undefined` for a class the stylesheet does not know.
 */
function stylesheetIcon(iconClass: string): InlineSvgIconDef | undefined {
  if (STYLESHEET_ICONS.has(iconClass)) return STYLESHEET_ICONS.get(iconClass);
  const doc = ownerDocument();
  const body = doc.body;
  const view = doc.defaultView;
  if (!body || !view) return undefined;
  const probe = doc.createElement('div');
  probe.className = iconClass;
  probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none';
  body.appendChild(probe);
  const raw = view.getComputedStyle(probe).getPropertyValue('--svg').trim();
  probe.remove();
  const source = /^url\(\s*(['"]?)data:image\/svg\+xml,([\s\S]*?)\1\s*\)$/.exec(raw)?.[2];
  const match = source && /<svg[^>]*\sviewBox=['"]([^'"]+)['"][^>]*>([\s\S]*)<\/svg>/.exec(decodeURIComponent(source));
  STYLESHEET_ICONS.set(iconClass, match ? rotated(iconClass, {
    viewBox: match[1],
    content: match[2].replace(/(fill|stroke)=(['"])black\2/g, '$1=$2currentColor$2'),
  }) : undefined);
  return STYLESHEET_ICONS.get(iconClass);
}

/** A `rotate-90` utility class rotated the placeholder box; a raw body gets the turn baked in instead. */
function rotated(iconClass: string, icon: InlineSvgIconDef): InlineSvgIconDef {
  const turn = iconClass.split(' ').map((part) => ROTATIONS[part]).find((deg) => deg !== undefined);
  if (!turn) return icon;
  const [minX = 0, minY = 0, width = 24, height = 24] = icon.viewBox.split(/[\s,]+/).map(Number);
  return { ...icon, content: `<g transform="rotate(${turn} ${minX + width / 2} ${minY + height / 2})">${icon.content}</g>` };
}

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
    x, y, width: size, height: size, class: 'icon-container', color, 'data-icon-key': iconKey ?? null,
  });
  const div = createHtml('div');
  div.className = cssClass;
  Object.assign(div.style, {
    width: `${size}px`,
    height: `${size}px`,
    fontSize: `${size}px`,
    color: color || 'currentColor',
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

function drawPlaceholder(container: SVGElement, iconKey: string, x: number, y: number, size: number, color: string): SVGElement {
  const g = create('g', { class: 'sf-icon-placeholder', 'data-icon-key': iconKey });
  append(g, create('rect', { x, y, width: size, height: size, rx: 3, ry: 3, fill: 'none', stroke: color, 'stroke-width': 1, opacity: 0.4 }));
  const text = create('text', {
    x: x + size / 2, y: y + size / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central',
    'font-family': PLACEHOLDER_FONT, 'font-size': Math.max(8, size * 0.6), fill: color, 'stroke-width': 0,
  });
  text.textContent = MARKER_ICONS[iconKey] ?? glyphFor(iconKey);
  append(g, text);
  append(container, g);
  return g;
}

function glyphFor(iconKey: string): string {
  const cleaned = iconKey.replace(/^i-[a-z]+-/i, '').replace(/[^a-z0-9]/gi, '');
  return (cleaned[0] ?? '?').toUpperCase();
}

/** Inline SVG paths scaled to fit `width × height` at `(x, y)`. */
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
  const g = create('g', { 'data-icon-key': iconKey ?? null, transform: `translate(${x}, ${y})` });
  const inner = create('g');
  const scale = Math.min(width / vbW, height / vbH);
  inner.setAttribute('transform', `translate(${(width - vbW * scale) / 2}, ${(height - vbH * scale) / 2}) scale(${scale})`);
  for (const d of iconDef.paths) append(inner, create('path', { d, fill: fillColor }));
  append(g, inner);
  append(container, g);
  return g;
}

/** A short abbreviation centred in an icon box (a behaverse scene: `NB`, `SART`). */
export function drawIconText(
  container: SVGElement,
  marker: string | undefined,
  x: number,
  y: number,
  size: number,
  color: string,
): SVGElement | undefined {
  if (!marker) return undefined;
  const glyph = marker.substring(0, 4);
  const text = create('text', {
    class: 'sf-icon-text',
    x: x + size / 2,
    y: y + size / 2,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': PLACEHOLDER_FONT,
    'font-size': glyph.length <= 2 ? size * 0.55 : size * 0.4,
    'font-weight': 'bold',
    fill: color,
    'stroke-width': 0,
  });
  text.textContent = glyph;
  append(container, text);
  return text;
}

export { createHtml };
