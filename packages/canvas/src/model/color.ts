/**
 * Element colour writeback (design §1 "colour (studyflow uses the bpmn.io colour
 * extension) → BO `di.fill`/`di.stroke` attrs", §6 P5).
 *
 * ## Which attributes, and why four of them
 *
 * bpmn.io stores element colour on the **DI** object, never on the business
 * object, under two parallel vocabularies — and `bpmn-js`'s own `SetColorHandler`
 * writes *both* on every call (`ensureLegacySupport`):
 *
 * | role | current (`color` ext) | legacy (`bioc` ext) |
 * |---|---|---|
 * | fill | `color:background-color` | `bioc:fill` |
 * | stroke | `color:border-color` | `bioc:stroke` |
 *
 * The shipped examples carry all four (`consort2025`, `sklearn_pipeline`,
 * `spirit2025`), the modeler's drawio exporter reads either
 * (`packages/modeler/src/export/drawio.ts`), and the canvas renderer already reads
 * either (`render/renderer.ts`). So a colour written here writes all four, exactly
 * as the modeler's `mutate.setColor` path does, and a pre-coloured example
 * round-trips untouched.
 *
 * The attributes are written under their **qualified** names (`'bioc:fill'`, not
 * `'fill'`). That is deliberate and works in both worlds: a moddle instance that
 * registers the bpmn.io colour packages indexes those extension properties under
 * their qualified name, and a bare `bpmn-moddle` (what the canvas package and its
 * specs use) keeps them as generic namespaced attributes — in which case the writer
 * still emits them *and* declares the `bioc:`/`color:` namespaces, because it knows
 * both URIs. Writing the local name `'fill'` instead would produce an unqualified
 * `fill="…"` attribute in the bare case, which nothing reads back.
 *
 * ## Connections take a stroke only
 *
 * `bpmn-js` assigns `border-color` to a connection and drops `background-color`
 * (`SetColorHandler.postExecute`: `pick(di, ['border-color'])`). {@link applyColors}
 * mirrors that — an edge silently ignores a `fill`, rather than growing an
 * attribute the renderer would never honour.
 */

import type { ModdleObject, SceneElement } from '@canvas/model/scene.ts';
import { asModdle, prop, setProp } from '@canvas/model/moddle.ts';

/**
 * A colour patch. A field that is **absent** is left untouched; a field that is
 * present but `undefined`/`null`/`''` **clears** that colour (the same
 * "falsy removes the colour" contract as `bpmn-js`'s `SetColorHandler`).
 */
export interface ElementColors {
  fill?: string | null;
  stroke?: string | null;
}

/** The DI attribute names each colour role is written to, current form first. */
export const COLOR_PROPERTIES: Readonly<Record<'fill' | 'stroke', readonly string[]>> = {
  fill: ['color:background-color', 'bioc:fill'],
  stroke: ['color:border-color', 'bioc:stroke'],
};

/**
 * Every name a colour may be *read* from, most specific first. The bare local
 * names come first because a moddle instance that registers the bpmn.io packages
 * materializes them there; the qualified names cover a bare `bpmn-moddle`. Kept in
 * step with `render/renderer.ts`, which reads the same lists.
 */
const READ_ORDER: Readonly<Record<'fill' | 'stroke', readonly string[]>> = {
  fill: ['fill', 'background-color', 'bioc:fill', 'color:background-color'],
  stroke: ['stroke', 'border-color', 'bioc:stroke', 'color:border-color'],
};

/** Three-digit hex shorthand (`#abc`) and the full form (`#aabbcc`). */
const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const FULL_HEX = /^#[0-9a-f]{6}$/i;
const RGB = /^rgb\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)$/i;

function channel(value: string): string {
  return Math.max(0, Math.min(255, Number.parseInt(value, 10))).toString(16).padStart(2, '0');
}

/**
 * Normalize a colour to the `#rrggbb` form bpmn.io stores, or `undefined` for a
 * falsy value (which means "clear this colour").
 *
 * Accepts `#rgb`, `#rrggbb` (any case) and `rgb(r, g, b)`. Anything else throws
 * with `bpmn-js`'s own message — its `colorToHex` uses a `<canvas>` 2d context to
 * resolve CSS colour names and rejects everything that does not serialize to plain
 * hex (alpha included), which is not available to a package that must run headless.
 * A caller with a DOM (the app's colour picker) resolves names before calling.
 */
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

/**
 * Normalize a whole patch up front, keeping the *presence* of each field (an absent
 * field means "leave alone", a present-but-falsy one means "clear"). Call this once
 * before writing a batch, so an invalid colour throws before any element is touched
 * rather than half way through.
 */
export function normalizeColors(colors: ElementColors): ElementColors {
  const out: ElementColors = {};
  for (const role of ['fill', 'stroke'] as const) {
    if (role in colors) out[role] = normalizeColor(colors[role]) ?? null;
  }
  return out;
}

/** The colours currently stored on a DI object, reading either vocabulary. */
export function readColorsOf(di: ModdleObject | undefined): ElementColors {
  if (!di) return {};
  const out: ElementColors = {};
  for (const role of ['fill', 'stroke'] as const) {
    for (const name of READ_ORDER[role]) {
      const value = prop(di, name);
      if (typeof value === 'string' && value) {
        out[role] = value;
        break;
      }
    }
  }
  return out;
}

/** The colours currently stored on an element's `bpmndi:BPMNShape`/`BPMNEdge`. */
export function readColors(element: SceneElement): ElementColors {
  return readColorsOf(element.di);
}

/**
 * Write `colors` onto `element`'s DI object in place, in both the current and the
 * legacy vocabulary. Returns whether anything actually changed — a repeat write, a
 * clear of an absent colour, or a `fill` aimed at an edge all write nothing, so a
 * no-op leaves the serialization byte-identical.
 *
 * The element's DI is the very `bpmndi:BPMNShape`/`BPMNEdge` object
 * `model/import.ts` referenced, so `bpmn-moddle` re-emits the colour with no
 * further bookkeeping; an element with no DI at all is skipped.
 */
export function applyColors(element: SceneElement, colors: ElementColors): boolean {
  const di = asModdle(element.di);
  if (!di) return false;
  let changed = false;
  for (const role of ['fill', 'stroke'] as const) {
    if (!(role in colors)) continue;
    // A connection carries a stroke only — the same slice `bpmn-js` assigns.
    if (role === 'fill' && element.kind === 'edge') continue;
    changed = writeColor(di, role, normalizeColor(colors[role])) || changed;
  }
  return changed;
}

/** Write (or clear) one colour role in both vocabularies. Whether anything changed. */
function writeColor(di: ModdleObject, role: 'fill' | 'stroke', value: string | undefined): boolean {
  let changed = false;
  for (const name of COLOR_PROPERTIES[role]) {
    const current = prop(di, name);
    const currentText = typeof current === 'string' ? current : undefined;
    if (currentText === value) continue;
    setProp(di, name, value);
    // A real moddle `set(name, undefined)` deletes the slot outright. A plain bag
    // (the hand-built-scene fallback) would keep the key with an `undefined` value,
    // which a naive serializer would still emit — so drop it here too.
    if (value === undefined) deleteAttr(di, name);
    changed = true;
  }
  return changed;
}

/** Remove a colour attribute's key outright, so nothing can serialize it back. */
function deleteAttr(di: ModdleObject, name: string): void {
  const attrs = (di as { $attrs?: Record<string, unknown> }).$attrs;
  if (attrs && name in attrs) delete attrs[name];
  const record = di as Record<string, unknown>;
  if (name in record && record[name] === undefined) delete record[name];
}
