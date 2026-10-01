/** Element colors: `#rrggbb` normalization and the two bpmn.io DI vocabularies. */

import type { ElementColors } from '@canvas/study/scene.ts';

const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const FULL_HEX = /^#[0-9a-f]{6}$/i;
const RGB = /^rgb\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)$/i;

function channel(value: string): string {
  return Math.max(0, Math.min(255, Number.parseInt(value, 10))).toString(16).padStart(2, '0');
}

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` → `#rrggbb`; a falsy value → `undefined`; anything else throws. */
export function normalizeColor(color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  const text = String(color).trim();
  if (!text) return undefined;
  const short = SHORT_HEX.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  if (FULL_HEX.test(text)) return text.toLowerCase();
  const rgb = RGB.exec(text);
  if (rgb) return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`;
  throw new Error(`invalid color value: ${color}`);
}

/** Normalise a patch, keeping the presence of each field (present-but-falsy clears). */
export function normalizeColors(colors: ElementColors): ElementColors {
  const out: ElementColors = {};
  for (const role of ['fill', 'stroke'] as const) {
    if (role in colors) out[role] = normalizeColor(colors[role]) ?? null;
  }
  return out;
}
