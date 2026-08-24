import { getStrokeColor } from 'bpmn-js/lib/draw/BpmnRenderUtil';
import { append as svgAppend, create as svgCreate } from 'tiny-svg';
import { isImageIcon } from '@core/notation';

export function colorToHex(color: string): string | null {
  const context = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = 'transparent';
  context.fillStyle = color;
  return /^#[0-9a-fA-F]{6}$/.test(context.fillStyle) ? context.fillStyle : null;
}

// px offsets/sizes tuned to centre a 2-4-char abbreviation in the icon box.
const MARKER_2CHAR = { x: 9, y: 20, fontSize: 11 };
const MARKER_3CHAR = { x: 8, y: 22, fontSize: 11 };
const MARKER_LONG = { x: 8.5, y: 21, fontSize: 8 };
const MARKER_MAX_CHARS = 4;

/**
 * Iconify paints its classes with a CSS mask. WebKit will not render a mask inside an SVG
 * `<foreignObject>` — the box lays out and a plain background paints, but the masked glyph never
 * appears, so every canvas icon silently vanishes in Safari. The mask source is a monochrome SVG
 * held in the class's `--svg` custom property, so we recolour it and paint it as a background
 * image, which WebKit does render. Same pixels in Chromium, and the DOM shape is unchanged so the
 * export path (`embedIconsInSvg`, which keys off `data-icon-class`) is untouched.
 */
const ICON_SOURCES = new Map<string, string | undefined>();

/** The `--svg` behind an iconify class, read once per class from a throwaway probe element. */
function iconSvgSource(iconClass: string): string | undefined {
  const cached = ICON_SOURCES.get(iconClass);
  if (cached !== undefined || ICON_SOURCES.has(iconClass)) return cached;

  const probe = document.createElement('div');
  probe.className = iconClass;
  probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const raw = getComputedStyle(probe).getPropertyValue('--svg').trim();
  probe.remove();

  const body = /^url\(\s*(['"]?)data:image\/svg\+xml,([\s\S]*?)\1\s*\)$/.exec(raw)?.[2];
  ICON_SOURCES.set(iconClass, body ? decodeURIComponent(body) : undefined);
  return ICON_SOURCES.get(iconClass);
}

/** These sources are monochrome by construction: they were built to be masks. */
const tint = (svgText: string, color: string): string =>
  svgText.replace(/(fill|stroke)=(['"])black\2/g, `$1=$2${color}$2`);

/**
 * Paints `iconClass` on `iconDiv` without a mask. Returns false when the class exposes no `--svg`
 * — an icon set the plugin did not emit — leaving the stylesheet's own mask in place.
 */
function paintIconAsBackground(iconDiv: HTMLElement, iconClass: string, color: string): boolean {
  const source = iconSvgSource(iconClass);
  if (!source) return false;

  const url = `url("data:image/svg+xml,${encodeURIComponent(tint(source, color))}")`;
  iconDiv.style.setProperty('mask-image', 'none', 'important');
  iconDiv.style.setProperty('-webkit-mask-image', 'none', 'important');
  iconDiv.style.setProperty('background-color', 'transparent', 'important');
  iconDiv.style.setProperty('background-image', url, 'important');
  iconDiv.style.setProperty('background-size', '100% 100%', 'important');
  iconDiv.style.setProperty('background-repeat', 'no-repeat', 'important');
  return true;
}

export function drawIcon(
  parentNode: SVGElement,
  element: any,
  iconClass: string | undefined,
  x: number = 4,
  y: number = 4,
  size: number = 26,
  colorOverride?: string,
): SVGElement | undefined {
  if (!iconClass) return;

  const color = colorOverride || colorToHex(getStrokeColor(element));

  // Image icons draw as-is (no CSS class, no currentColor tinting) and export as an <image>.
  if (isImageIcon(iconClass)) {
    const image = svgCreate('image', { x, y, width: size, height: size, class: 'icon-container' });
    image.setAttribute('href', iconClass);
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', iconClass);
    svgAppend(parentNode, image);
    return image;
  }

  const foreignObject = svgCreate('foreignObject', {
    x, y,
    width: size,
    height: size,
    class: 'icon-container',
    color: color,
  });

  const iconDiv = document.createElement('div');
  iconDiv.className = iconClass;
  iconDiv.style.width = size + 'px';
  iconDiv.style.height = size + 'px';
  iconDiv.style.fontSize = size + 'px';
  iconDiv.style.color = color || 'currentColor';
  // Block, not inline: an inline box leaves a baseline gap inside the foreignObject.
  iconDiv.style.display = 'block';
  iconDiv.style.lineHeight = '1';
  iconDiv.style.verticalAlign = 'top';
  iconDiv.style.margin = '0';
  iconDiv.style.padding = '0';
  iconDiv.style.boxSizing = 'border-box';
  iconDiv.setAttribute('data-icon-class', iconClass);
  iconDiv.setAttribute('data-icon-color', color || '');
  paintIconAsBackground(iconDiv, iconClass, color || 'currentColor');
  foreignObject.appendChild(iconDiv);
  svgAppend(parentNode, foreignObject);

  return foreignObject;
}

/** Inline paths, unlike `drawIcon`'s CSS class; these survive SVG export. */
export function drawSvgPaths(
  parentNode: SVGElement,
  iconDef: { viewBox: string; paths: string[] },
  x: number,
  y: number,
  width: number,
  height: number,
  fillColor: string,
): SVGElement {
  const [, , vbW, vbH] = iconDef.viewBox.split(/\s+/).map(Number);
  const g = svgCreate('g');
  g.setAttribute('transform', `translate(${x}, ${y})`);

  const inner = svgCreate('g');
  const sx = width / vbW;
  const sy = height / vbH;
  const scale = Math.min(sx, sy);
  const dx = (width - vbW * scale) / 2;
  const dy = (height - vbH * scale) / 2;
  inner.setAttribute('transform', `translate(${dx}, ${dy}) scale(${scale})`);

  for (const d of iconDef.paths) {
    const path = svgCreate('path', { d, fill: fillColor });
    svgAppend(inner, path);
  }

  svgAppend(g, inner);
  svgAppend(parentNode, g);
  return g;
}

export function drawIconText(
  parentNode: SVGElement,
  element: any,
  marker: string | undefined,
): SVGElement | undefined {
  if (!marker) return;

  let x: number;
  let y: number;
  let fontSize: number;

  if (marker.length === 2) { ({ x, y, fontSize } = MARKER_2CHAR); }
  else if (marker.length === 3) { ({ x, y, fontSize } = MARKER_3CHAR); }
  else { ({ x, y, fontSize } = MARKER_LONG); marker = marker.substring(0, MARKER_MAX_CHARS); }

  const text = svgCreate('text', {
    x, y, fontSize,
    fontFamily: 'ui-monospace, monospace',
    fill: getStrokeColor(element),
    fontWeight: 'bold',
    strokeWidth: 0,
  });

  text.textContent = marker;
  svgAppend(parentNode, text);
  return text;
}

export function removeDefaultMarkers(parentGfx: SVGElement): void {
  const markerPaths = parentGfx.querySelectorAll('[data-marker]');
  markerPaths.forEach((path) => {
    if (path.getAttribute('data-marker') === 'sub-process') {
      const prevSibling = path.previousElementSibling;
      if (prevSibling && prevSibling.tagName.toLowerCase() === 'rect') {
        prevSibling.remove();
      }
    }
    path.remove();
  });
}
