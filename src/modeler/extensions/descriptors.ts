import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { toLocalName } from '../utils/naming';

function matchesPropertyDescriptor(prop: any, propertyName: string | undefined): boolean {
  if (!prop || !propertyName) return false;

  const localName = toLocalName(propertyName);

  return prop?.name === propertyName
    || prop?.ns?.name === propertyName
    || prop?.ns?.localName === propertyName
    || prop?.name === localName
    || prop?.ns?.name === localName
    || prop?.ns?.localName === localName;
}

export function findPropertyDescriptor(properties: any[], propertyName: string | undefined): any {
  return properties?.find((prop: any) => matchesPropertyDescriptor(prop, propertyName));
}

function getEffectiveDescriptor(elementOrDescriptor: any, model?: any): any {
  const typeName = elementOrDescriptor?.$type ?? elementOrDescriptor?.ns?.name;
  const registry = model?.registry;

  if (typeName && typeof registry?.getEffectiveDescriptor === 'function') {
    try {
      return registry.getEffectiveDescriptor(typeName);
    } catch {
      // Fall back to the attached descriptor.
    }
  }

  return elementOrDescriptor?.$descriptor ?? elementOrDescriptor;
}

export function getEffectiveDescriptorProperties(elementOrDescriptor: any, model?: any): any[] {
  const descriptor = getEffectiveDescriptor(elementOrDescriptor, model);

  if (Array.isArray(descriptor?.properties) && descriptor.properties.length > 0) {
    return descriptor.properties;
  }

  const propertiesByName = descriptor?.propertiesByName;
  if (!propertiesByName) return [];

  const seen = new Set<string>();

  return Object.values(propertiesByName).filter((prop: any) => {
    const key = prop?.ns?.name ?? prop?.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getEffectivePropertyDescriptor(elementOrBusinessObject: any, propertyName: string | undefined): any {
  const businessObject = getBusinessObject(elementOrBusinessObject);
  const model = businessObject?.$model;

  if (model?.getPropertyDescriptor && propertyName) {
    return model.getPropertyDescriptor(businessObject, propertyName);
  }

  return findPropertyDescriptor(getEffectiveDescriptorProperties(businessObject, model), propertyName);
}

export function getBusinessObjectPropertyDescriptor(elementOrBusinessObject: any, propertyName: string | undefined): any {
  return getEffectivePropertyDescriptor(elementOrBusinessObject, propertyName);
}

export function getExtensionPropertyDescriptor(extensionElement: any, propertyName: string | undefined): any {
  const model = extensionElement?.$model;

  if (model?.getPropertyDescriptor && propertyName) {
    return model.getPropertyDescriptor(extensionElement, propertyName);
  }

  return findPropertyDescriptor(getEffectiveDescriptorProperties(extensionElement, model), propertyName);
}

export function getElementProperties(elementOrBusinessObject: any): any[] {
  const businessObject = getBusinessObject(elementOrBusinessObject);
  return getEffectiveDescriptorProperties(businessObject, businessObject?.$model);
}

export function getRedefinedPropertyName(descriptor: any): string | undefined {
  const reference = descriptor?.redefines ?? descriptor?.replaces;

  if (typeof reference !== 'string') return undefined;

  const match = reference.match(/^[^#]+#(.+)$/);
  if (!match) return undefined;

  return toLocalName(match[1]);
}
