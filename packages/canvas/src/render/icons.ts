/**
 * Icons. The host resolves a key (a marker name, a BPMN local name) to a glyph:
 * an SVG body, a CSS class the host's icon pipeline paints, or an image.
 */

import type { Element } from '@core/model/index.ts';
import { append, create, createHtml, ownerDocument } from '@canvas/render/svg.ts';

/** Raw SVG markup, drawn as a nested `<svg>` so an export is self-contained. */
export interface InlineSvgIconDef {
  viewBox: string;
  content: string;
}

/** A class the host's stylesheet paints; drawn inline when the stylesheet carries its glyph, else as a placeholder. */
export interface CssIconDef {
  cssClass: string;
}

/**
 * An image URL, drawn as an SVG `<image>`: it keeps its own colours, and runs no script
 * however the document came by it. The browser loads `href`, so hand it only a `data:` URL.
 */
export interface ImageIconDef {
  href: string;
}

export type IconDef = CssIconDef | InlineSvgIconDef | ImageIconDef;

/** The glyph `iconKey` names; none, `null` or `undefined`, draws nothing. */
export type IconResolver = (iconKey: string, element?: Element) => IconDef | null | undefined;

function isCssIcon(def: IconDef): def is CssIconDef {
  return typeof (def as CssIconDef).cssClass === 'string';
}

function isInlineIcon(def: IconDef): def is InlineSvgIconDef {
  return typeof (def as InlineSvgIconDef).content === 'string';
}

/** Draw `iconKey` at `(x, y)` sized `size`: the resolver's answer, else nothing. */
export function drawIcon(
  container: SVGElement,
  iconKey: string | undefined,
  x: number,
  y: number,
  size: number,
  color: string,
  resolver?: IconResolver,
  element?: Element,
): SVGElement | undefined {
  if (!iconKey) return undefined;
  const resolved = resolver?.(iconKey, element);
  if (!resolved) return undefined;
  if (isCssIcon(resolved)) {
    const inline = stylesheetIcon(resolved.cssClass);
    return inline
      ? drawInlineSvgIcon(container, inline, x, y, size, color, iconKey)
      : drawCssIcon(container, resolved.cssClass, x, y, size, color, iconKey);
  }
  if (isInlineIcon(resolved)) return drawInlineSvgIcon(container, resolved, x, y, size, color, iconKey);
  return drawImageIcon(container, resolved, x, y, size, size, iconKey);
}

/** An image icon fitted to `width × height` at `(x, y)`, keeping its own shape: a logotype runs wide. */
export function drawImageIcon(
  container: SVGElement,
  def: ImageIconDef,
  x: number,
  y: number,
  width: number,
  height: number,
  iconKey: string,
): SVGElement {
  return append(container, create('image', { x, y, width, height, href: def.href, class: 'sf-icon', 'data-icon-key': iconKey }));
}

function drawInlineSvgIcon(
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

function drawCssIcon(
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

const GLYPH_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** A short abbreviation centred in an icon box: the value a type's `meta.glyph` names. */
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
    'font-family': GLYPH_FONT,
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
