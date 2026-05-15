import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { toLocalName } from '../utils/naming';

function matches(prop: any, name: string | undefined): boolean {
  if (!prop || !name) return false;
  const local = toLocalName(name);
  return prop.name === name
    || prop.ns?.name === name
    || prop.ns?.localName === name
    || prop.name === local
    || prop.ns?.name === local
    || prop.ns?.localName === local;
}

export function findPropertyDescriptor(properties: any[], name: string | undefined): any {
  return properties?.find((p) => matches(p, name));
}

function getDescriptor(elementOrDescriptor: any, model?: any): any {
  const typeName = elementOrDescriptor?.$type ?? elementOrDescriptor?.ns?.name;
  const registry = model?.registry;
  if (typeName && typeof registry?.getEffectiveDescriptor === 'function') {
    try { return registry.getEffectiveDescriptor(typeName); } catch { /* fall through */ }
  }
  return elementOrDescriptor?.$descriptor ?? elementOrDescriptor;
}

export function getEffectiveDescriptorProperties(elementOrDescriptor: any, model?: any): any[] {
  const descriptor = getDescriptor(elementOrDescriptor, model);

  if (Array.isArray(descriptor?.properties) && descriptor.properties.length > 0) {
    return descriptor.properties;
  }

  const byName = descriptor?.propertiesByName;
  if (!byName) return [];

  const seen = new Set<string>();
  return Object.values(byName).filter((p: any) => {
    const key = p?.ns?.name ?? p?.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getEffectivePropertyDescriptor(elementOrBO: any, name: string | undefined): any {
  const bo = getBusinessObject(elementOrBO);
  const model = bo?.$model;
  if (model?.getPropertyDescriptor && name) return model.getPropertyDescriptor(bo, name);
  return findPropertyDescriptor(getEffectiveDescriptorProperties(bo, model), name);
}

// Alias kept for call-site clarity (BO vs. extension element).
export const getBusinessObjectPropertyDescriptor = getEffectivePropertyDescriptor;

export function getExtensionPropertyDescriptor(extensionElement: any, name: string | undefined): any {
  const model = extensionElement?.$model;
  if (model?.getPropertyDescriptor && name) return model.getPropertyDescriptor(extensionElement, name);
  return findPropertyDescriptor(getEffectiveDescriptorProperties(extensionElement, model), name);
}

export function getElementProperties(elementOrBO: any): any[] {
  const bo = getBusinessObject(elementOrBO);
  return getEffectiveDescriptorProperties(bo, bo?.$model);
}

export function getRedefinedPropertyName(descriptor: any): string | undefined {
  const ref = descriptor?.redefines ?? descriptor?.replaces;
  if (typeof ref !== 'string') return undefined;
  const match = ref.match(/^[^#]+#(.+)$/);
  return match ? toLocalName(match[1]) : undefined;
}
