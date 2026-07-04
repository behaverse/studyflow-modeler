/** Convert a CSS color string to a `#rrggbb` hex code via the canvas parser,
 *  or null if it does not resolve to an opaque hex color. */
export function colorToHex(color: string): string | null {
  const context = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = 'transparent';
  context.fillStyle = color;
  return /^#[0-9a-fA-F]{6}$/.test(context.fillStyle) ? context.fillStyle : null;
}
