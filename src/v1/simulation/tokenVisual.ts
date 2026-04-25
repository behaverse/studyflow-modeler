import { create as svgCreate, attr as svgAttr, append as svgAppend, remove as svgRemove } from 'tiny-svg';

export const TOKEN_RADIUS = 8;

/**
 * Create a token SVG circle, set its color, and append it to the layer.
 */
export function createTokenSvg(layer: any, color: string, cx = 0, cy = 0): any {
  const svg = svgCreate('circle');
  svgAttr(svg, { cx, cy, r: TOKEN_RADIUS });
  svg.style.fill = color;
  svgAppend(layer, svg);
  return svg;
}

/**
 * Update the cx/cy of a token SVG circle.
 */
export function updateTokenPosition(svg: any, cx: number, cy: number): void {
  svgAttr(svg, { cx, cy });
}

/**
 * Remove a token SVG element from its parent.
 */
export function removeTokenSvg(svg: any): void {
  svgRemove(svg);
}
