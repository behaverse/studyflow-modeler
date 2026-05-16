import { getStrokeColor } from 'bpmn-js/lib/draw/BpmnRenderUtil';
import { append as svgAppend, create as svgCreate } from 'tiny-svg';

/** Convert a CSS color string to a hex color code. */
export function colorToHex(color: string): string | null {
  const context = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = 'transparent';
  context.fillStyle = color;
  return /^#[0-9a-fA-F]{6}$/.test(context.fillStyle) ? context.fillStyle : null;
}

/** Draw a foreignObject-based icon using an iconify CSS class. */
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
  // Square block with no inline gap so the icon fills the foreignObject exactly.
  iconDiv.style.display = 'block';
  iconDiv.style.lineHeight = '1';
  iconDiv.style.verticalAlign = 'top';
  iconDiv.style.margin = '0';
  iconDiv.style.padding = '0';
  iconDiv.style.boxSizing = 'border-box';
  iconDiv.setAttribute('data-icon-class', iconClass);
  iconDiv.setAttribute('data-icon-color', color || '');
  foreignObject.appendChild(iconDiv);
  svgAppend(parentNode, foreignObject);

  return foreignObject;
}

/** Draw an icon using inline SVG paths; survives SVG export, unlike CSS-based icons. */
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

/** Draw a short text marker (truncated to 4 chars) sized by length. */
export function drawIconText(
  parentNode: SVGElement,
  element: any,
  marker: string | undefined,
): SVGElement | undefined {
  if (!marker) return;

  let x: number;
  let y: number;
  let fontSize: number;

  if (marker.length === 2) { x = 9; y = 20; fontSize = 11; }
  else if (marker.length === 3) { x = 8; y = 22; fontSize = 11; }
  else { x = 8.5; y = 21; fontSize = 8; marker = marker.substring(0, 4); }

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

/** Remove default BPMN markers rendered by the base renderer. */
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
