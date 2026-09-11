/**
 * A caption's look: weight, italic, alignment and ink. One DI attribute
 * (`studyflow:font` on the `bpmndi:BPMNShape` / `BPMNEdge`, which the document
 * spells `font`) holding space-separated tokens, `bold italic right #ac5a54` like `fill` and `stroke`.
 */

import { normalizeColor } from '@canvas/model/color.ts';

export type TextAlign = 'left' | 'center' | 'right';

export interface Font {
  bold?: boolean;
  italic?: boolean;
  align?: TextAlign;
  color?: string;
}

/** An omitted field is left alone, a falsy one clears. */
export interface FontPatch {
  bold?: boolean;
  italic?: boolean;
  align?: TextAlign | null;
  color?: string | null;
}

export const FONT_PROPERTY = 'studyflow:font';

const ALIGNS: ReadonlySet<string> = new Set(['left', 'center', 'right']);

/** `bold italic right #ac5a54` → a font; tokens it does not know are dropped; nothing → `undefined`. */
export function parseFont(text: unknown): Font | undefined {
  if (typeof text !== 'string') return undefined;
  const font: Font = {};
  for (const token of text.trim().split(/\s+/)) {
    if (token === 'bold') font.bold = true;
    else if (token === 'italic') font.italic = true;
    else if (ALIGNS.has(token)) font.align = token as TextAlign;
    else if (token.startsWith('#')) {
      try {
        font.color = normalizeColor(token);
      } catch {
        // not a colour after all
      }
    }
  }
  return Object.keys(font).length > 0 ? font : undefined;
}

/** The inverse of {@link parseFont}, in canonical order; an empty font → `undefined`. */
export function formatFont(font: Font | undefined): string | undefined {
  if (!font) return undefined;
  const tokens = [font.bold && 'bold', font.italic && 'italic', font.align, font.color].filter(Boolean);
  return tokens.length > 0 ? tokens.join(' ') : undefined;
}

/** `font` with `patch` applied; `undefined` once nothing is left. */
export function mergeFont(font: Font | undefined, patch: FontPatch): Font | undefined {
  const next: Font = {
    ...font,
    ...('bold' in patch ? { bold: patch.bold || undefined } : {}),
    ...('italic' in patch ? { italic: patch.italic || undefined } : {}),
    ...('align' in patch ? { align: patch.align || undefined } : {}),
    ...('color' in patch ? { color: normalizeColor(patch.color) } : {}),
  };
  for (const key of Object.keys(next) as (keyof Font)[]) if (next[key] === undefined) delete next[key];
  return Object.keys(next).length > 0 ? next : undefined;
}
