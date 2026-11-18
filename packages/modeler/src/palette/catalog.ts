/**
 * Everything the modeler can add, as one list: BPMN's own elements (`groups.ts`), the types the enabled skills declare,
 * and their templates. The tools' kind flyouts, the Add panel, the pinned tools and the Change menu all read it, so an
 * element has one name, one icon and one kind wherever it shows.
 */

import { bpmnSelfAndAncestors, getCatalog, hasCatalog, humanizeLabel, type TypeEntry } from '@core/notation';
import { toLocalName } from '@core/naming';
import { PALETTE_BPMN_ICONS, PALETTE_GROUPS, getPaletteIconForBpmnType } from '@modeler/palette/groups';

/** The kinds, in the order the tools list them. */
export const KINDS: readonly string[] = PALETTE_GROUPS.map((group) => group.label);

/** What templates are filed under: after every kind. */
export const TEMPLATES = 'Templates';

export type AddEntry = {
  /**
   * Stable across sessions, so a pin can name it: `create-<Label>` for BPMN's own (`create-Timer-Start`), `create-<type>`
   * for a skill's type (`create-reachy:LookAt`), `template-<id>` for a template.
   */
  id: string;
  label: string;
  /** What it is filed under: one of {@link KINDS}, a skill's type's own category, or {@link TEMPLATES}. */
  kind: string;
  /** The skill that adds it, and whether that skill always loads (`required`, as Core does); none for BPMN's own. */
  skill?: { prefix: string; name: string; required: boolean };
  /** Iconify class or image URL, drawn by `PaletteIcon`. */
  icon?: string;
  /** A template's description, said on hover. */
  description?: string;
  /** Lower-cased words a search matches the start of: the label's, the type's, the skill's, the kind's. */
  keywords: string;
  bpmnType: string;
  extensionType?: string;
  /** Properties the variant needs (`eventDefinitions` for a timer start). */
  attributes?: Record<string, unknown>;
  /** A template's id: the entry adds the template's elements. */
  template?: string;
};

/**
 * Whether a skill's type is offered: one a person makes (not abstract, a trait, a value, or one BPMN's own entry
 * stands for, such as `studyflow:StartEvent`), with a BPMN type to mint.
 */
export function isAddable(type: TypeEntry): boolean {
  return !type.hiddenFromPalette && type.bpmnType !== null;
}

function words(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/** A type's local name as one word and as words: `UserTask` is found by "usertask" and by "user task". */
function typeWords(type: string): string {
  const local = toLocalName(type) ?? type;
  return `${local} ${humanizeLabel(local)}`;
}

/** A type's icon when its schema gives none: its BPMN type's, or the nearest ancestor's the tools draw. */
function iconFor(bpmnType: string): string | undefined {
  return getPaletteIconForBpmnType(bpmnType)
    ?? bpmnSelfAndAncestors(bpmnType).map((type) => PALETTE_BPMN_ICONS[type]).find(Boolean);
}

/**
 * Every entry: BPMN's own, kind by kind, then each enabled skill's types and templates, in the order the skills load.
 * Read afresh by each caller: turning a skill off in Settings replaces the catalog.
 */
export function addEntries(): AddEntry[] {
  const own = PALETTE_GROUPS.flatMap((group) => group.items.map((item): AddEntry => ({
    id: `create-${item.label.replace(/\s+/g, '-')}`,
    label: item.label,
    kind: group.label,
    icon: item.icon ?? getPaletteIconForBpmnType(item.bpmnType) ?? group.icon,
    keywords: words(item.label, typeWords(item.bpmnType), group.label),
    bpmnType: item.bpmnType,
    ...(item.extensionType ? { extensionType: item.extensionType } : {}),
    ...(item.attributes ? { attributes: item.attributes } : {}),
  })));
  // The catalog is downloaded at boot; asked before that, the list is BPMN's own rather than an exception.
  if (!hasCatalog()) return own;

  return [...own, ...getCatalog().schemas.flatMap((schema) => {
    const skill = { prefix: schema.prefix, name: schema.name, required: schema.required };
    const types = schema.types.filter(isAddable).map((type): AddEntry => {
      // A type no kind takes is filed under its skill's name, after the kinds.
      const kind = type.paletteGroup ?? schema.name;
      return {
        id: `create-${type.name}`,
        label: type.paletteLabel,
        kind,
        skill,
        icon: type.iconClass ?? iconFor(type.bpmnType!) ?? schema.icon,
        // Its own name, not its BPMN type's: "task" finds a skill's task by name, not every skill type a service task carries.
        keywords: words(type.paletteLabel, typeWords(type.name), schema.name, kind),
        bpmnType: type.bpmnType!,
        extensionType: type.name,
      };
    });
    const templates = schema.templates.map((template): AddEntry => ({
      id: `template-${template.id}`,
      label: template.name,
      kind: TEMPLATES,
      skill,
      icon: template.iconClass ?? types.find((type) => type.extensionType === template.extensionType)?.icon
        ?? schema.icon ?? iconFor(template.bpmnType),
      ...(template.description ? { description: template.description } : {}),
      keywords: words(template.name, schema.name, TEMPLATES),
      bpmnType: template.bpmnType,
      ...(template.extensionType ? { extensionType: template.extensionType } : {}),
      template: template.id,
    }));
    return [...types, ...templates];
  })];
}

/** `entries` filed for a list: the kinds in the tools' order, any other category after them, the templates last. */
export function byKind(entries: readonly AddEntry[]): { kind: string; entries: AddEntry[] }[] {
  const order = [...KINDS];
  for (const entry of entries) if (!order.includes(entry.kind) && entry.kind !== TEMPLATES) order.push(entry.kind);
  order.push(TEMPLATES);
  return order
    .map((kind) => ({ kind, entries: entries.filter((entry) => entry.kind === kind) }))
    .filter((section) => section.entries.length > 0);
}
