import { getStrokeColor } from "bpmn-js/lib/draw/BpmnRenderUtil";
import { append as svgAppend, create as svgCreate } from "tiny-svg";

/**
 * Convert a CSS color string to a hex color code.
 */
export function colorToHex(color) {
  const context = document.createElement('canvas').getContext('2d');
  context.fillStyle = 'transparent';
  context.fillStyle = color;
  return /^#[0-9a-fA-F]{6}$/.test(context.fillStyle) ? context.fillStyle : null;
}

/**
 * Draw a diamond (rhombus) shape — used for gateways.
 */
export function drawDiamond(parentGfx, element, attrs, styles) {
  const width = element.width;
  const height = element.height;

  const x_2 = width / 2;
  const y_2 = height / 2;

  const points = [
    { x: x_2, y: 0 },
    { x: width, y: y_2 },
    { x: x_2, y: height },
    { x: 0, y: y_2 }
  ];

  const pointsString = points.map(point => point.x + ',' + point.y).join(' ');

  attrs = styles.computeStyle(attrs, {
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 2,
    stroke: getStrokeColor(element),
    fill: 'white'
  });

  const polygon = svgCreate('polygon', {
    ...attrs,
    points: pointsString
  });

  svgAppend(parentGfx, polygon);
  return polygon;
}

/**
 * Draw a foreignObject-based icon using an iconify CSS class.
 */
export function drawIcon(parentNode, element, iconClass, x = 4, y = 4, size = 26, colorOverride = undefined) {
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
  iconDiv.setAttribute('data-icon-class', iconClass);
  iconDiv.setAttribute('data-icon-color', color || '');
  foreignObject.appendChild(iconDiv);
  svgAppend(parentNode, foreignObject);

  return foreignObject;
}

/**
 * Draw an icon using inline SVG paths (no foreignObject / CSS).
 * This survives SVG export unlike CSS-based icons.
 */
export function drawSvgPaths(parentNode, iconDef, x, y, width, height, fillColor) {
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

/**
 * Draw a short text label inside an icon area (e.g. behaverse task abbreviation).
 */
export function drawIconText(parentNode, element, marker, x = 9, y = 21, fontSize = 12) {
  if (!marker) return;

  switch (marker.length) {
    case 2:
      x = 9;
      y = 20;
      fontSize = 11;
      break;
    case 3:
      x = 8;
      y = 22;
      fontSize = 11;
      break;
    default:
      marker = marker.substring(0, 4);
      x = 8.5;
      y = 21;
      fontSize = 8;
      break;
  }

  const text = svgCreate('text', {
    x, y, fontSize,
    fontFamily: 'ui-monospace, monospace',
    fill: getStrokeColor(element),
    fontWeight: 'bold',
    strokeWidth: 0
  });

  text.textContent = marker;
  svgAppend(parentNode, text);
  return text;
}

/**
 * Remove default BPMN markers rendered by the base renderer.
 */
export function removeDefaultMarkers(parentGfx) {
  const markerPaths = parentGfx.querySelectorAll('[data-marker]');
  markerPaths.forEach(path => {
    if (path.getAttribute('data-marker') === 'sub-process') {
      const prevSibling = path.previousElementSibling;
      if (prevSibling && prevSibling.tagName.toLowerCase() === 'rect') {
        prevSibling.remove();
      }
    }
    path.remove();
  });
}
