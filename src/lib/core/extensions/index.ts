import { getCatalog, type AttributeSpec } from '../catalog';
import { CORE_PREFIXES } from '../constants';
import { splitQName, toLocalName } from '../naming';

/**
 * Schema-attribute access on BPMN elements.
 *
 * Schema types attach to elements in two styles (see `catalog/types.ts`):
 * wrapper types live inside `<bpmn:extensionElements>`, trait types mix their
 * attributes straight onto the business object. This module resolves reads
 * and writes across both — callers address attributes by name and never care
 * where the value is stored.
 */

/** bpmn-js elements carry the moddle object on `businessObject`. */
export function toBusinessObject(elementOrBO: any): any {
  return elementOrBO?.businessObject ?? elementOrBO;
}

function typeNameOf(elementOrType: any): string | undefined {
  if (typeof elementOrType === 'string') return elementOrType;
  const target = toBusinessObject(elementOrType);
  return target?.$type ?? target?.ns?.name;
}

export function isExtensionPrefix(prefix: string | undefined): boolean {
  return !!prefix && !CORE_PREFIXES.has(prefix);
}

// ---------------------------------------------------------------------------
// Raw XML attributes ($attrs) — values unknown to the loaded schemas
// ---------------------------------------------------------------------------

export function getRawAttribute(target: any, localName: string, preferredPrefix?: string): string | undefined {
  const rawAttributes = target?.$attrs;
  if (!rawAttributes || typeof rawAttributes !== 'object') return undefined;

  const pick = (value: any) => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

  if (preferredPrefix) {
    const value = pick(rawAttributes[`${preferredPrefix}:${localName}`]);
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

export function setRawAttribute(target: any, attributeName: string, value: any): void {
  if (!target || value === undefined) return;

  if (typeof target.set === 'function') {
    try {
      target.set(attributeName, value);
      return;
    } catch {
      // fall through to direct $attrs mutation
    }
  }

  if (target.$attrs && typeof target.$attrs === 'object') {
    target.$attrs[attributeName] = value;
  }
}

// ---------------------------------------------------------------------------
// Attribute definitions (catalog lookups)
// ---------------------------------------------------------------------------

/** BPMN-native identity attributes, addressable as `bpmn:id`/`bpmn:name`. */
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

/** All schema-defined attributes for this element/type (BPMN natives excluded). */
export function getAttributeDefinitions(elementOrType: any): AttributeSpec[] {
  return getCatalog().instanceAttributesOf(typeNameOf(elementOrType));
}

/** Definition for a single named attribute, including the bpmn:id/bpmn:name pair. */
export function getAttributeDefinition(elementOrBO: any, name: string | undefined): AttributeSpec | undefined {
  if (!name) return undefined;
  const spec = getCatalog().attributeOf(typeNameOf(elementOrBO), name);
  if (spec) return spec;
  const local = toLocalName(name);
  return local ? BPMN_NATIVE_SPECS[local] : undefined;
}

/** Default attribute values for a schema type, across its inheritance chain. */
export function getDefaults(typeName: string): Record<string, any> {
  return { ...getCatalog().defaultsOf(typeName) };
}

// ---------------------------------------------------------------------------
// Extension wrapper — thin delegators to the StudyflowElement handle, which
// owns this logic (see ./element). Kept for call sites that read the wrapper
// without needing a handle.
// ---------------------------------------------------------------------------

/** First non-core extension wrapper on `<bpmn:extensionElements>`, or null. */
export function getExtensionElement(elementOrBO: any): any {
  return StudyflowElement.fromBusinessObject(elementOrBO).extension;
}

/** `$type` of the wrapper inside `<bpmn:extensionElements>`. */
export function getExtensionType(elementOrBO: any): string | undefined {
  return StudyflowElement.fromBusinessObject(elementOrBO).extensionType;
}

/** Attribute definitions declared on this element's extension wrapper, if any. */
export function getExtensionAttributeDefinitions(elementOrBO: any): AttributeSpec[] {
  return StudyflowElement.fromBusinessObject(elementOrBO).extensionAttributes();
}

/** True when extension attributes are mixed onto the BO via schema traits. */
export function hasTraitAttributes(element: any): boolean {
  return StudyflowElement.fromBusinessObject(element).hasTraits;
}

/** Adds a wrapper inside `<bpmn:extensionElements>`; trait types write defaults straight to the BO. */
export function createExtensionElement(
  bo: any,
  extensionType: string,
  moddle: any,
  defaults: Record<string, any> = {},
): any {
  return StudyflowElement.fromBusinessObject(bo).ensureExtension(extensionType, moddle, defaults);
}

// ---------------------------------------------------------------------------
// Attribute reads and writes — resolved by the StudyflowElement handle
// ---------------------------------------------------------------------------

import {
  StudyflowElement,
  fromElement,
  fromBusinessObject,
  directWriter,
  modelingWriter,
  type Writer,
} from './element';

export { StudyflowElement, fromElement, fromBusinessObject, directWriter, modelingWriter, type Writer };

/** Read a resolved attribute value off an element or business object.
 *  Thin delegator to {@link StudyflowElement}. */
export function getAttribute(elementOrBO: any, attributeName: string): any {
  return StudyflowElement.fromBusinessObject(elementOrBO).read(attributeName);
}

/** Write a resolved attribute value. With `modeling`, writes through bpmn-js
 *  (undo/redo) on the element; without it, mutates the business object directly.
 *  Thin delegator to {@link StudyflowElement}. */
export function setAttribute(element: any, attributeName: string, value: any, modeling?: any): void {
  const handle = modeling
    ? StudyflowElement.fromElement(element, modeling)
    : StudyflowElement.fromBusinessObject(element);
  handle.write(attributeName, value);
}
