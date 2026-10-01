import { getCatalog, type AttributeSpec } from '@core/notation';
import { NON_EXTENSION_PREFIXES } from '@core/constants';
import { splitQName, toLocalName, toPrefix } from '@core/naming';
import type { ModdleElement } from '@core/element/moddle';

export function toBusinessObject(elementOrBO: any): ModdleElement {
  return elementOrBO?.businessObject ?? elementOrBO;
}

/** The `bpmn:Definitions` an element, or its business object, belongs to. */
export function definitionsOf(elementOrBO: any): ModdleElement | undefined {
  for (let node: ModdleElement | undefined = toBusinessObject(elementOrBO); node; node = node.$parent) {
    if (node.$type === 'bpmn:Definitions') return node;
  }
  return undefined;
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

export function getAttributeSpecs(elementOrType: ModdleElement | string | null | undefined): readonly AttributeSpec[] {
  return getCatalog().instanceAttributesOf(typeNameOf(elementOrType));
}

/** The spec of the attribute `name` an element, or a type by its name, takes. */
export function getAttributeSpec(
  elementOrBO: ModdleElement | string | null | undefined,
  name: string | undefined,
): AttributeSpec | undefined {
  if (!name) return undefined;
  const spec = getCatalog().attributeOf(typeNameOf(elementOrBO), name);
  if (spec) return spec;
  const local = toLocalName(name);
  return local ? BPMN_NATIVE_SPECS[local] : undefined;
}
