import { getCatalog, type AttributeSpec } from '../catalog';
import { BPMN, CORE_PREFIXES } from '../constants';
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
function toBusinessObject(elementOrBO: any): any {
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
// Extension wrapper (the schema element inside <bpmn:extensionElements>)
// ---------------------------------------------------------------------------

/** First non-core extension wrapper on `<bpmn:extensionElements>`, or null. */
export function getExtensionElement(elementOrBO: any): any {
  const bo = toBusinessObject(elementOrBO);
  const values = bo?.extensionElements?.values;
  if (!values) return null;
  return values.find((ext: any) => isExtensionPrefix(splitQName(ext.$type).prefix)) ?? null;
}

/** `$type` of the wrapper inside `<bpmn:extensionElements>`; the wrapper is the single source of truth. */
export function getExtensionType(elementOrBO: any): string | undefined {
  return getExtensionElement(elementOrBO)?.$type;
}

/** Attribute definitions declared on this element's extension wrapper, if any. */
export function getExtensionAttributeDefinitions(elementOrBO: any): AttributeSpec[] {
  const ext = getExtensionElement(elementOrBO);
  return ext ? getAttributeDefinitions(ext) : [];
}

/** True when extension attributes are mixed onto the BO via schema traits. */
export function hasTraitAttributes(element: any): boolean {
  const bo = toBusinessObject(element);
  return getAttributeDefinitions(bo).some((spec) => isExtensionPrefix(spec.ns?.prefix));
}

/** Adds a wrapper inside `<bpmn:extensionElements>`; trait types write defaults straight to the BO. */
export function createExtensionElement(
  bo: any,
  extensionType: string,
  moddle: any,
  defaults: Record<string, any> = {},
): any {
  const entry = getCatalog().getType(extensionType);

  if (entry?.style === 'trait') {
    for (const [name, value] of Object.entries(defaults)) {
      setAttribute(bo, name, value);
    }
    return null;
  }

  if (!bo.extensionElements) {
    const ext = moddle.create(BPMN.ExtensionElements, { values: [] });
    ext.$parent = bo;
    bo.extensionElements = ext;
  }

  const wrapper = moddle.create(extensionType, {});
  wrapper.$parent = bo.extensionElements;
  bo.extensionElements.values.push(wrapper);

  for (const [name, value] of Object.entries(defaults)) {
    setAttribute(bo, name, value);
  }

  return wrapper;
}

// ---------------------------------------------------------------------------
// Attribute reads and writes (resolution across BO and wrapper)
// ---------------------------------------------------------------------------

type Resolved = {
  bo: any;
  ext: any;
  attributeName: string | undefined;
  target: any;
  targetKind: 'business-object' | 'extension-element';
};

function resolveName(name: string | undefined, attrDef: AttributeSpec | undefined): string | undefined {
  if (name === 'bpmn:id') return 'id';
  if (name === 'bpmn:name') return 'name';
  return attrDef?.name ?? attrDef?.ns?.localName ?? toLocalName(name);
}

function resolveAttribute(elementOrBO: any, attributeName: string): Resolved {
  const bo = toBusinessObject(elementOrBO);
  const ext = getExtensionElement(bo);
  const boDef = getAttributeDefinition(bo, attributeName);
  const extDef = getAttributeDefinition(ext, attributeName);

  // Extension redefines a BO attribute -> write under the redefined name.
  if (extDef && ext) {
    const redefined = extDef.redefinedName;
    if (redefined && (boDef || hasTraitAttributes(bo))) {
      return { bo, ext, attributeName: redefined, target: bo, targetKind: 'business-object' };
    }
  }

  if (boDef) {
    return {
      bo, ext,
      attributeName: resolveName(attributeName, boDef),
      target: bo,
      targetKind: 'business-object',
    };
  }

  if (extDef && ext) {
    return {
      bo, ext,
      attributeName: resolveName(attributeName, extDef),
      target: ext,
      targetKind: 'extension-element',
    };
  }

  // Unknown attribute: pick a target that won't silently drop the write.
  const useExt = !!ext && !hasTraitAttributes(bo);
  return {
    bo, ext,
    attributeName: resolveName(attributeName, undefined),
    target: useExt ? ext : bo,
    targetKind: useExt ? 'extension-element' : 'business-object',
  };
}

function read(target: any, name: string): any {
  if (!target) return undefined;
  return typeof target.get === 'function' ? target.get(name) : target[name];
}

/** Body-wrapped attribute (e.g. `cognitive:Configurations`): unwrap the value
 *  of the child element transparently. The body property is precompiled on
 *  the catalog spec, so no type-registry probing happens here. */
function unwrapBodyValue(rawValue: any, attrDef: AttributeSpec | undefined): any {
  if (!rawValue || typeof rawValue !== 'object' || !rawValue.$type) return rawValue;
  if (!attrDef?.bodyProp) return rawValue;
  const inner = read(rawValue, attrDef.bodyProp);
  return inner ?? '';
}

export function getAttribute(elementOrBO: any, attributeName: string): any {
  const r = resolveAttribute(elementOrBO, attributeName);
  if (!r.target || !r.attributeName) return undefined;

  // Pinned defaults on the wrapper take precedence over the BO value.
  if (r.ext && r.target === r.bo) {
    const extDef = getAttributeDefinition(r.ext, attributeName);
    if (extDef) {
      const extName = extDef.name ?? extDef.ns?.localName ?? r.attributeName;
      const extValue = read(r.ext, extName);
      if (extValue !== undefined) return unwrapBodyValue(extValue, extDef);
    }
  }

  const value = read(r.target, r.attributeName);
  const attrDef = getAttributeDefinition(r.target, r.attributeName);
  return unwrapBodyValue(value, attrDef);
}

export function setAttribute(element: any, attributeName: string, value: any, modeling?: any): void {
  const r = resolveAttribute(element, attributeName);
  if (!r.target || !r.attributeName) return;

  const attrDef = getAttributeDefinition(r.target, r.attributeName);
  const bodyProp = attrDef?.bodyProp;

  // Body-wrapped attribute: keep the wrapper instance and update its body.
  if (bodyProp && (typeof value === 'string' || value == null)) {
    const existing = read(r.target, r.attributeName);

    if (existing && typeof existing === 'object' && existing.$type) {
      if (!modeling) {
        if (typeof existing.set === 'function') existing.set(bodyProp, value ?? '');
        else existing[bodyProp] = value ?? '';
      } else {
        modeling.updateModdleProperties(element, existing, { [bodyProp]: value ?? '' });
      }
      return;
    }

    // Need a fresh wrapper of the declared type so writes survive
    // serialization; `$model` is the moddle instance attached to live elements.
    const model = r.target?.$model ?? r.bo?.$model;
    if (model && attrDef?.type) {
      value = model.create(attrDef.type, { [bodyProp]: value ?? '' });
    }
  }

  if (!modeling) {
    if (typeof r.target.set === 'function') r.target.set(r.attributeName, value);
    else r.target[r.attributeName] = value;
    return;
  }

  if (r.targetKind === 'business-object') {
    modeling.updateProperties(element, { [r.attributeName]: value });
  } else {
    modeling.updateModdleProperties(element, r.target, { [r.attributeName]: value });
  }
}
