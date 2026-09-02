/**
 * What the create/append menus offer — one list for both (P6b §3A).
 *
 * bpmn-js assembled this from two plugin providers: its own for the plain BPMN
 * half, the app's for the schema half. Nothing contributes now, so this module
 * assembles both ends itself: the app's curated BPMN groups (`palette/groups.ts`,
 * the same entries the palette flyouts show) followed by every appendable schema
 * type, grouped by the schema that declares it.
 *
 * {@link isAppendable} lives here so the create and append menus cannot drift.
 */

import { getCatalog, hasCatalog, HIDDEN_SCHEMA_TYPES, type TypeEntry } from '@core/notation';
import { toLocalName } from '@core/naming';
import { getPaletteIconForBpmnType, PALETTE_GROUPS } from '@modeler/palette/groups';

/**
 * Whether a schema type can be created from a menu at all: concrete, not already
 * covered by the static palette groups, and backed by a BPMN type to mint.
 *
 * Note this deliberately does NOT test `hiddenFromPalette` — the "more elements"
 * menu is the superset the palette flyouts trim down from.
 */
export function isAppendable(type: TypeEntry): boolean {
  return !type.isAbstract
    && !HIDDEN_SCHEMA_TYPES.has(type.name)
    && type.bpmnType !== null;
}

/** One creatable element, resolved down to what a menu row needs. */
export type PopupElementEntry = {
  id: string;
  label: string;
  bpmnType: string;
  extensionType?: string;
  attributes?: Record<string, unknown>;
  /** Iconify class or image URL; rendered by `palette/PaletteIcon`. */
  icon?: string;
  /** Lower-cased haystack the search box matches against. */
  keywords: string;
};

export type PopupElementGroup = {
  id: string;
  name: string;
  entries: PopupElementEntry[];
};

function keywordsFor(label: string, bpmnType: string, extensionType?: string): string {
  return [label, toLocalName(bpmnType) ?? bpmnType, bpmnType, extensionType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Every element the create/append menus can offer, grouped for display.
 *
 * Pure and catalog-driven — no editor, no backend. Callers rebuild it whenever a
 * menu opens, which is also what keeps it honest after an extension is toggled in
 * Settings (the catalog is replaced, not mutated).
 */
export function buildElementEntries(): PopupElementGroup[] {
  const groups: PopupElementGroup[] = PALETTE_GROUPS.map((group) => ({
    id: `bpmn:${group.label}`,
    name: group.label,
    entries: group.items.map((item) => ({
      id: `create-${item.label.replace(/\s+/g, '-')}`,
      label: item.label,
      bpmnType: item.bpmnType,
      extensionType: item.extensionType,
      attributes: item.attributes,
      icon: item.icon ?? getPaletteIconForBpmnType(item.bpmnType) ?? group.icon,
      keywords: keywordsFor(item.label, item.bpmnType, item.extensionType),
    })),
  }));

  // The catalog is downloaded at boot; a menu opened before that is BPMN-only
  // rather than an exception.
  if (!hasCatalog()) return groups;

  for (const schema of getCatalog().schemas) {
    const entries = schema.types.filter(isAppendable).map((type): PopupElementEntry => ({
      id: `append-${type.name}`,
      label: type.paletteLabel,
      bpmnType: type.bpmnType!,
      extensionType: type.name,
      icon: type.iconClass ?? getPaletteIconForBpmnType(type.bpmnType!) ?? schema.icon,
      keywords: keywordsFor(type.paletteLabel, type.bpmnType!, type.name),
    }));
    if (entries.length > 0) groups.push({ id: `schema:${schema.prefix}`, name: schema.name, entries });
  }

  return groups;
}
