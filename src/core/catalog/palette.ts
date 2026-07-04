/**
 * Palette metadata: which schema types show up in the palette, under which
 * category, and with what label. Pure functions over the raw schema shape;
 * the compiler calls these while building each `TypeEntry`.
 */

import { toLocalName } from '@/core/naming';
import { isBpmnSubtypeOf } from '@/core/catalog/bpmn';

/** Types whose `superClass` names one of these are value types, not elements. */
const VALUE_TYPE_SUPER_CLASSES = ['String', 'Boolean', 'Integer', 'Float', 'Double'];

/** Schema types backed by the static palette groups instead of schema items. */
export const HIDDEN_SCHEMA_TYPES = new Set(['Study', 'StartEvent', 'EndEvent', 'SequenceFlow']);

/** Palette category per BPMN ancestor; order matters (containers before Activity). */
const CATEGORY_RULES: Array<{ ancestor: string; category: string }> = [
  { ancestor: 'bpmn:Event', category: 'Events' },
  { ancestor: 'bpmn:Gateway', category: 'Gateways' },
  { ancestor: 'bpmn:SubProcess', category: 'Containers' },
  { ancestor: 'bpmn:Participant', category: 'Containers' },
  { ancestor: 'bpmn:Group', category: 'Containers' },
  { ancestor: 'bpmn:Activity', category: 'Activities' },
  { ancestor: 'bpmn:DataObjectReference', category: 'Data' },
  { ancestor: 'bpmn:DataStoreReference', category: 'Data' },
  { ancestor: 'bpmn:ItemAwareElement', category: 'Data' },
];

/** Skip abstract types, value types, trait-only types, and template-only types. */
export function isHiddenFromPalette(rawType: Record<string, any>, style: 'wrapper' | 'trait'): boolean {
  if (rawType.isAbstract || HIDDEN_SCHEMA_TYPES.has(rawType.name)) return true;
  if (rawType.superClass?.some((sc: string) => VALUE_TYPE_SUPER_CLASSES.includes(sc))) return true;
  if (Array.isArray(rawType.meta?.flowElements) && rawType.meta.flowElements.length > 0) return true;
  if (style === 'trait') return true;
  if (rawType.meta?.templateScopedType) return true;
  return false;
}

const STRIPPABLE_SUFFIXES = ['Gateway', 'Event'];

/** Drop the BPMN base-type suffix (e.g. "ExclusiveGateway" -> "Exclusive"). */
export function trimBpmnSuffix(typeName: string, bpmnType: string): string {
  const bpmnLocal = toLocalName(bpmnType) ?? bpmnType;
  for (const suffix of STRIPPABLE_SUFFIXES) {
    if (!bpmnLocal.endsWith(suffix)) continue;
    if (typeName === suffix) continue;
    if (typeName.endsWith(suffix) && typeName.length - suffix.length >= 3) {
      return typeName.slice(0, -suffix.length);
    }
  }
  return typeName;
}

export function humanizeLabel(typeName: string): string {
  return typeName
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

export function paletteCategories(meta: Record<string, any>, bpmnType: string | null): string[] {
  const explicit = meta?.categories;
  if (Array.isArray(explicit) && explicit.length > 0) return explicit;
  if (!bpmnType) return [];
  for (const { ancestor, category } of CATEGORY_RULES) {
    if (isBpmnSubtypeOf(bpmnType, ancestor)) return [category];
  }
  return [];
}
