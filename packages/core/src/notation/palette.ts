import { toLocalName } from '@core/naming';
import { isValueType, type SchemaTypeModel } from '@core/notation/moddlePackage';
import { isBpmnSubtypeOf } from '@core/notation/bpmn';
import type { TypeMeta, TypeStyle } from '@core/notation/types';

/** Already offered by the static palette groups; qualified, so only the studyflow schema's are hidden. */
export const HIDDEN_SCHEMA_TYPES = new Set([
  'studyflow:Study',
  'studyflow:StartEvent',
  'studyflow:EndEvent',
  'studyflow:SequenceFlow',
]);

/** First match wins, so containers must precede Activity. */
const GROUP_RULES: Array<{ ancestor: string; group: string }> = [
  { ancestor: 'bpmn:Event', group: 'Events' },
  { ancestor: 'bpmn:Gateway', group: 'Gateways' },
  { ancestor: 'bpmn:SubProcess', group: 'Containers' },
  { ancestor: 'bpmn:Participant', group: 'Containers' },
  { ancestor: 'bpmn:Group', group: 'Containers' },
  { ancestor: 'bpmn:Activity', group: 'Activities' },
  // A choreography task is listed with the activities, as BPMN's own is (`palette/groups.ts`).
  { ancestor: 'bpmn:ChoreographyActivity', group: 'Activities' },
  { ancestor: 'bpmn:DataObjectReference', group: 'Data' },
  { ancestor: 'bpmn:DataStoreReference', group: 'Data' },
  { ancestor: 'bpmn:ItemAwareElement', group: 'Data' },
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

/** A type's group in the tools: the one its schema names (`meta.paletteGroup`), else its BPMN ancestor's. */
export function paletteGroup(meta: TypeMeta, bpmnType: string | null): string | undefined {
  if (typeof meta?.paletteGroup === 'string' && meta.paletteGroup) return meta.paletteGroup;
  if (!bpmnType) return undefined;
  return GROUP_RULES.find(({ ancestor }) => isBpmnSubtypeOf(bpmnType, ancestor))?.group;
}
