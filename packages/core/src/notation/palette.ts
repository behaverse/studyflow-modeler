import { toLocalName } from '@core/naming';
import { isValueType, type SchemaTypeModel } from '@core/notation/schemaFile';
import { isBpmnSubtypeOf } from '@core/notation/bpmn';
import type { TypeMeta, TypeStyle } from '@core/notation/types';

/** Already offered by the static palette groups; qualified, so only the core schema's are hidden. */
export const HIDDEN_SCHEMA_TYPES = new Set([
  'studyflow:Study',
  'studyflow:StartEvent',
  'studyflow:EndEvent',
  'studyflow:SequenceFlow',
]);

/** First match wins, so containers must precede Activity. */
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

export function isHiddenFromPalette(
  qualifiedName: string,
  rawType: SchemaTypeModel,
  style: TypeStyle,
): boolean {
  if (rawType.isAbstract || HIDDEN_SCHEMA_TYPES.has(qualifiedName)) return true;
  if (isValueType(rawType)) return true;
  if (style === 'trait') return true;
  return false;
}

/** An icon given as an image URL rather than an iconify class (`data:image/...` or `https://...`). */
export function isImageIcon(icon: string): boolean {
  return /^(https?:\/\/|data:image\/)/i.test(icon);
}

const STRIPPABLE_SUFFIXES = ['Gateway', 'Event'];

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

export function paletteCategories(meta: TypeMeta, bpmnType: string | null): string[] {
  const explicit = meta?.categories;
  if (Array.isArray(explicit) && explicit.length > 0) return explicit;
  if (!bpmnType) return [];
  for (const { ancestor, category } of CATEGORY_RULES) {
    if (isBpmnSubtypeOf(bpmnType, ancestor)) return [category];
  }
  return [];
}
