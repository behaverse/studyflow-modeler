import { getCatalog, type AttributeSpec } from '@behaverse/studyflow-core/notation';
import { NON_EXTENSION_PREFIXES } from '@behaverse/studyflow-core/constants';
import { splitQName, toLocalName, toPrefix } from '@behaverse/studyflow-core/naming';
import type { ModdleElement } from '@behaverse/studyflow-core/element/moddle';

export function toBusinessObject(elementOrBO: any): ModdleElement {
  return elementOrBO?.businessObject ?? elementOrBO;
}

function typeNameOf(elementOrType: ModdleElement | string | null | undefined): string | undefined {
  if (typeof elementOrType === 'string') return elementOrType;
  const target = toBusinessObject(elementOrType);
  return target?.$type ?? target?.ns?.name;
}

export function isExtensionPrefix(prefix: string | undefined): boolean {
  return !!prefix && !NON_EXTENSION_PREFIXES.has(prefix);
}

/** The `$attrs` bag: attributes no descriptor declares. The element's own prefix is tried first, then any other extension prefix. */
export function getRawAttribute(target: ModdleElement | null | undefined, localName: string): string | undefined {
  const rawAttributes = target?.$attrs;
  if (!rawAttributes || typeof rawAttributes !== 'object') return undefined;

  const pick = (value: any) => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

  const ownPrefix = toPrefix(target?.$type);
  if (ownPrefix) {
    const value = pick(rawAttributes[`${ownPrefix}:${localName}`]);
    if (value) return value;
  }

  const exact = pick(rawAttributes[localName]);
  if (exact) return exact;

  for (const [name, rawValue] of Object.entries(rawAttributes)) {
    const value = pick(rawValue);
    if (!value) continue;
    const { prefix, localName: candidateLocalName } = splitQName(name);
    if (candidateLocalName === localName && isExtensionPrefix(prefix)) return value;
  }

  return undefined;
}

/** A *view* over the marked `bpmn:documentation` entry, not a stored attribute — `StudyflowElement` routes reads and writes; this spec only gives the inspector a field to render. */
export const CHECKLIST_SPEC: AttributeSpec = {
  name: 'checklist',
  ns: { name: 'studyflow:checklist', prefix: 'studyflow', localName: 'checklist' },
  type: 'String',
  description: 'Items to check off when completing the element - markdown task items (`- [ ]` / `- [x]`), carried as a marked `bpmn:documentation` entry so every BPMN tool shows the text.',
  meta: { editor: 'checklist', categories: ['Documentation'] },
};

const BPMN_NATIVE_SPECS: Record<string, AttributeSpec> = {
  id: {
    name: 'id',
    ns: { name: 'bpmn:id', prefix: 'bpmn', localName: 'id' },
    type: 'String',
    isAttr: true,
    isId: true,
  },
  name: {
    name: 'name',
    ns: { name: 'bpmn:name', prefix: 'bpmn', localName: 'name' },
    type: 'String',
    isAttr: true,
  },
};

export function getAttributeSpecs(elementOrType: ModdleElement | string | null | undefined): AttributeSpec[] {
  return getCatalog().instanceAttributesOf(typeNameOf(elementOrType));
}

export function getAttributeSpec(
  elementOrBO: ModdleElement | null | undefined,
  name: string | undefined,
): AttributeSpec | undefined {
  if (!name) return undefined;
  const spec = getCatalog().attributeOf(typeNameOf(elementOrBO), name);
  if (spec) return spec;
  const local = toLocalName(name);
  if (local === 'checklist') return CHECKLIST_SPEC;
  return local ? BPMN_NATIVE_SPECS[local] : undefined;
}
