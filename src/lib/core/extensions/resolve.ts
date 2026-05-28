import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { toLocalName } from '../utils/naming';
import { getAttributeDefinition, getRedefinedName } from './attributeDefinitions';
import { getExtensionElement, hasExtends } from './wrapper';

type Resolved = {
  bo: any;
  ext: any;
  attributeName: string | undefined;
  target: any;
  targetKind: 'business-object' | 'extension-element';
};

function resolveName(name: string | undefined, attrDef: any): string | undefined {
  if (name === 'bpmn:id') return 'id';
  if (name === 'bpmn:name') return 'name';
  return attrDef?.name ?? attrDef?.ns?.localName ?? toLocalName(name);
}

function resolveAttribute(elementOrBO: any, attributeName: string): Resolved {
  const bo = getBusinessObject(elementOrBO);
  const ext = getExtensionElement(bo);
  const boDef = getAttributeDefinition(bo, attributeName);
  const extDef = getAttributeDefinition(ext, attributeName);

  // Extension redefines a BO attribute -> write under the redefined name.
  if (extDef && ext) {
    const redefined = getRedefinedName(extDef);
    if (redefined && (boDef || hasExtends(bo))) {
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
  const useExt = !!ext && !hasExtends(bo);
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

const PRIMITIVE_MODDLE_TYPES = new Set(['String', 'Integer', 'Real', 'Boolean', 'Number']);

/** If `attrDef.type` is a moddle type whose single body property carries the value,
 *  return that body property name. This lets attribute reads/writes drill into
 *  child-element wrappers (e.g. `cognitive:Configurations`) transparently.
 *  Uses `registry.getEffectiveDescriptor` so an inherited body property is still
 *  found on a subclass (e.g. `behaverse:BotConfigurations` inherits `value`
 *  from `cognitive:Configurations`). `getTypeDescriptor` returns only own
 *  properties and would miss it. */
function getBodyPropertyName(attrDef: any, model: any): string | undefined {
  const typeRef = attrDef?.type;
  if (!typeRef || typeof typeRef !== 'string') return undefined;
  if (PRIMITIVE_MODDLE_TYPES.has(typeRef)) return undefined;

  let typeDef: any;
  try { typeDef = model?.registry?.getEffectiveDescriptor?.(typeRef) ?? model?.getTypeDescriptor?.(typeRef); }
  catch { return undefined; }
  if (!typeDef) return undefined;

  const props: any[] = Array.isArray(typeDef.properties)
    ? typeDef.properties
    : Object.values(typeDef.propertiesByName ?? {});
  return props.find((p: any) => p?.isBody)?.name;
}

function unwrapBodyValue(rawValue: any, attrDef: any, model: any): any {
  if (!rawValue || typeof rawValue !== 'object' || !rawValue.$type) return rawValue;
  const bodyProp = getBodyPropertyName(attrDef, model);
  if (!bodyProp) return rawValue;
  const inner = typeof rawValue.get === 'function' ? rawValue.get(bodyProp) : rawValue[bodyProp];
  return inner ?? '';
}

export function getAttribute(elementOrBO: any, attributeName: string): any {
  const r = resolveAttribute(elementOrBO, attributeName);
  if (!r.target || !r.attributeName) return undefined;

  const model = r.target?.$model ?? r.bo?.$model;

  // Pinned defaults on the wrapper take precedence over the BO value.
  if (r.ext && r.target === r.bo) {
    const extDef = getAttributeDefinition(r.ext, attributeName);
    if (extDef) {
      const extName = extDef.name ?? extDef.ns?.localName ?? r.attributeName;
      const extValue = read(r.ext, extName);
      if (extValue !== undefined) return unwrapBodyValue(extValue, extDef, model);
    }
  }

  const value = read(r.target, r.attributeName);
  const attrDef = getAttributeDefinition(r.target, r.attributeName);
  return unwrapBodyValue(value, attrDef, model);
}

export function setAttribute(element: any, attributeName: string, value: any, modeling?: any): void {
  const r = resolveAttribute(element, attributeName);
  if (!r.target || !r.attributeName) return;

  const model = r.target?.$model ?? r.bo?.$model;
  const attrDef = getAttributeDefinition(r.target, r.attributeName);
  const bodyProp = getBodyPropertyName(attrDef, model);

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

    // Need to create a fresh wrapper of the declared type so writes survive serialization.
    const typeRef = attrDef?.type;
    if (model && typeRef) {
      const wrapper = model.create(typeRef, { [bodyProp]: value ?? '' });
      value = wrapper;
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
