/**
 * The drawing tools every document of this skill uses: the canvas's ink, written into the picture so a saved SVG carries
 * its own paint, and text measured without a DOM, so a document is drawn the same in the page, in Node and in a spec.
 */

/** The canvas's ink (packages/canvas/src/view/theme.ts, `INK`), which its index does not export. */
export const INK = {
  stroke: '#44403c',
  text: '#1c1917',
  muted: '#78716c',
  paper: '#ffffff',
  box: '#f5f5f4',
  rule: '#d6d3d1',
} as const;

export const FONT_FAMILY = 'IBM Plex Sans, Helvetica, Arial, sans-serif';

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A number as an SVG attribute: two decimals at most, no trailing zeros. */
export function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

// Advance widths in em of a humanist sans, by class of character and a little wide of the mark: a line that is
// estimated to fit, fits.
const NARROW = new Set("iIl.,:;'|!".split(''));
const SLIM = new Set('jtfr()[]-/ '.split(''));
const WIDE = new Set('mwMW@%'.split(''));

function advance(char: string): number {
  if (NARROW.has(char)) return 0.29;
  if (SLIM.has(char)) return 0.38;
  if (WIDE.has(char)) return 0.88;
  if (char >= '0' && char <= '9') return 0.6;
  if (char >= 'A' && char <= 'Z') return 0.66;
  return 0.55;
}

/** The width `text` takes at `size` pixels, estimated. */
export function textWidth(text: string, size: number, bold = false): number {
  let em = 0;
  for (const char of text) em += advance(char);
  return em * size * (bold ? 1.06 : 1);
}

/** `text` broken at spaces into lines no wider than `width`; a word wider than that keeps a line of its own. */
export function wrap(text: string, width: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, bold) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  return line ? [...lines, line] : lines;
}

/** A name as a document quotes it: without the count it ends in, `(n=12)` or `(n=...)`, which the document writes itself. */
export function withoutCount(name: string): string {
  return name.replace(/\s*\(\s*n\s*=[^)]*\)\s*$/i, '').trim();
}

/** The first letter of a line in upper case, the rest as written. */
export function sentenceCase(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** `body` as a standalone SVG on white paper, `title` for whoever reads it without seeing it. */
export function svgDocument(width: number, height: number, title: string, body: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}" font-family="${FONT_FAMILY}" font-size="12" fill="${INK.text}">`,
    `  <title>${escapeXml(title)}</title>`,
    `  <rect width="${num(width)}" height="${num(height)}" fill="${INK.paper}"/>`,
    ...body.map((line) => `  ${line}`),
    '</svg>',
    '',
  ].join('\n');
}
