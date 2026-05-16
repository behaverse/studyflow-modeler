import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { toLocalName } from '../utils/naming';

/** Resolve a moddle type definition for an element, using inline type metadata as a fallback. */
function getTypeDefinition(elementOrType: any, model?: any): any {
  const typeName = elementOrType?.$type ?? elementOrType?.ns?.name;
  const registry = model?.registry;
  if (typeName && typeof registry?.getEffectiveDescriptor === 'function') {
    try { return registry.getEffectiveDescriptor(typeName); } catch { /* fall through */ }
  }
  return elementOrType?.$descriptor ?? elementOrType;
}

function matchesName(attrDef: any, name: string): boolean {
  if (!attrDef) return false;
  const local = toLocalName(name);
  return attrDef.name === name
    || attrDef.ns?.name === name
    || attrDef.ns?.localName === name
    || attrDef.name === local
    || attrDef.ns?.name === local
    || attrDef.ns?.localName === local;
}

/** All attribute definitions declared on this element's moddle type (deduped by qualified name). */
export function getAttributeDefinitions(elementOrType: any, model?: any): any[] {
  const typeDef = getTypeDefinition(elementOrType, model);

  if (Array.isArray(typeDef?.properties) && typeDef.properties.length > 0) {
    return typeDef.properties;
  }

  const byName = typeDef?.propertiesByName;
  if (!byName) return [];

  const seen = new Set<string>();
  return Object.values(byName).filter((attrDef: any) => {
    const key = attrDef?.ns?.name ?? attrDef?.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Definition for a single named attribute on a BO, extension element, or raw moddle type. */
export function getAttributeDefinition(elementOrBO: any, name: string | undefined): any {
  if (!name) return undefined;
  const target = getBusinessObject(elementOrBO);
  const model = target?.$model;
  if (typeof model?.getPropertyDescriptor === 'function') return model.getPropertyDescriptor(target, name);
  return getAttributeDefinitions(target, model).find((attrDef) => matchesName(attrDef, name));
}

/** Local name of the attribute this definition overrides via `redefines:` or `replaces:`. */
export function getRedefinedName(attrDef: any): string | undefined {
  const ref = attrDef?.redefines ?? attrDef?.replaces;
  if (typeof ref !== 'string') return undefined;
  const match = ref.match(/^[^#]+#(.+)$/);
  return match ? toLocalName(match[1]) : undefined;
}
