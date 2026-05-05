/**
 * Helper utilities for reading/writing studyflow extension elements
 * in the BPMN extensionElements container.
 *
 * Standalone version — no bpmn-js dependency.
 */

import { getBusinessObject } from './businessObject';

export const CORE_PREFIXES = new Set([
  'bpmn',
  'bpmndi',
  'dc',
  'di',
  'xsi',
  'xml'
]);

export function isExtensionPrefix(prefix: string | undefined): boolean {
  return Boolean(prefix && !CORE_PREFIXES.has(prefix));
}

export function getNamespacedAttrValue(
  target: any,
  attrLocalName: string,
  preferredPrefix?: string,
): string | undefined {
  const attrs = target?.$attrs;

  if (!attrs || typeof attrs !== 'object') {
    return undefined;
  }

  if (preferredPrefix) {
    const preferredValue = attrs[`${preferredPrefix}:${attrLocalName}`];
    if (typeof preferredValue === 'string' && preferredValue.trim() !== '') {
      return preferredValue;
    }
  }

  const exactValue = attrs[attrLocalName];
  if (typeof exactValue === 'string' && exactValue.trim() !== '') {
    return exactValue;
  }

  for (const [attrName, value] of Object.entries(attrs)) {
    if (typeof value !== 'string' || value.trim() === '') {
      continue;
    }

    const separatorIndex = attrName.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const prefix = attrName.slice(0, separatorIndex);
    const localName = attrName.slice(separatorIndex + 1);

    if (localName === attrLocalName && isExtensionPrefix(prefix)) {
      return value;
    }
  }

  return undefined;
}

/**
 * Get the studyflow extension element wrapper from a BPMN element
 * or an already-resolved business object.
 * Returns the first extension element found, or null.
 */
export function getExtensionElement(elementOrBusinessObject: any): any {
  const bo = getBusinessObject(elementOrBusinessObject);
  const values = bo?.extensionElements?.values;
  if (!values) return null;

  return values.find((ext: any) =>
    isExtensionPrefix(ext.$type?.split(':')?.[0])
  ) ?? null;
}

/**
 * The applied studyflow type is the `$type` of the extension element wrapper
 * inside `<bpmn:extensionElements>`. Wrapper presence is the single source of
 * truth — there is no XML attribute, no inference fallback.
 */
export function getAppliedStudyflowType(elementOrBusinessObject: any): string | undefined {
  return getExtensionElement(elementOrBusinessObject)?.$type;
}

export function resolveContext(elementOrBusinessObject: any) {
  const businessObject = getBusinessObject(elementOrBusinessObject);
  const extensionElement = getExtensionElement(businessObject);

  return {
    element: elementOrBusinessObject?.businessObject ? elementOrBusinessObject : undefined,
    businessObject,
    extensionElement,
    hasStudyflowExtends: hasStudyflowExtends(businessObject),
    hasWrapperExtension: Boolean(extensionElement),
  };
}

function matchesPropertyDescriptor(prop: any, propertyName: string | undefined): boolean {
  if (!prop || !propertyName) {
    return false;
  }

  const names = [propertyName];

  return names.some((name) => {
    const localName = toLocalName(name);

    return prop?.name === name
      || prop?.ns?.name === name
      || prop?.ns?.localName === name
      || prop?.name === localName
      || prop?.ns?.name === localName
      || prop?.ns?.localName === localName;
  });
}

function findPropertyDescriptor(properties: any[], propertyName: string | undefined): any {
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

function getEffectiveDescriptorProperties(elementOrDescriptor: any, model?: any): any[] {
  const descriptor = getEffectiveDescriptor(elementOrDescriptor, model);

  if (Array.isArray(descriptor?.properties) && descriptor.properties.length > 0) {
    return descriptor.properties;
  }

  const propertiesByName = descriptor?.propertiesByName;
  if (!propertiesByName) {
    return [];
  }

  const seen = new Set<string>();

  return Object.values(propertiesByName).filter((prop: any) => {
    const key = prop?.ns?.name ?? prop?.name;
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getEffectivePropertyDescriptor(elementOrBusinessObject: any, propertyName: string | undefined): any {
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

function getExtensionPropertyDescriptor(extensionElement: any, propertyName: string | undefined): any {
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

export function getExtensionElementProperties(elementOrBusinessObject: any): any[] {
  const extensionElement = getExtensionElement(elementOrBusinessObject);
  return getEffectiveDescriptorProperties(extensionElement, extensionElement?.$model);
}

function getResolvedPropertyName(propertyName: string | undefined, descriptor: any): string | undefined {
  if (propertyName === 'bpmn:id') {
    return 'id';
  }

  if (propertyName === 'bpmn:name') {
    return 'name';
  }

  return descriptor?.name
    ?? descriptor?.ns?.localName
    ?? toLocalName(propertyName);
}

export function getRedefinedPropertyName(descriptor: any): string | undefined {
  const reference = descriptor?.redefines ?? descriptor?.replaces;

  if (typeof reference !== 'string') {
    return undefined;
  }

  const match = reference.match(/^[^#]+#(.+)$/);
  if (!match) {
    return undefined;
  }

  return toLocalName(match[1]);
}

export function resolveProperty(elementOrBusinessObject: any, propertyName: string) {
  const context = resolveContext(elementOrBusinessObject);
  const businessObjectDescriptor = getEffectivePropertyDescriptor(context.businessObject, propertyName);
  const extensionDescriptor = getExtensionPropertyDescriptor(context.extensionElement, propertyName);

  if (extensionDescriptor && context.extensionElement) {
    const redefinedPropertyName = getRedefinedPropertyName(extensionDescriptor);

    if (redefinedPropertyName && (businessObjectDescriptor || context.hasStudyflowExtends)) {
      return {
        ...context,
        descriptor: extensionDescriptor,
        propertyName: redefinedPropertyName,
        target: context.businessObject,
        usesExtension: false,
        updateKind: 'properties',
      };
    }
  }

  if (businessObjectDescriptor) {
    return {
      ...context,
      descriptor: businessObjectDescriptor,
      propertyName: getResolvedPropertyName(propertyName, businessObjectDescriptor),
      target: context.businessObject,
      usesExtension: false,
      updateKind: 'properties',
    };
  }

  if (extensionDescriptor && context.extensionElement) {
    return {
      ...context,
      descriptor: extensionDescriptor,
      propertyName: getResolvedPropertyName(propertyName, extensionDescriptor),
      target: context.extensionElement,
      usesExtension: true,
      updateKind: 'moddle-properties',
    };
  }

  if (context.hasStudyflowExtends) {
    return {
      ...context,
      descriptor: undefined,
      propertyName: getResolvedPropertyName(propertyName, undefined),
      target: context.businessObject,
      usesExtension: false,
      updateKind: 'properties',
    };
  }

  if (context.extensionElement) {
    return {
      ...context,
      descriptor: undefined,
      propertyName: getResolvedPropertyName(propertyName, undefined),
      target: context.extensionElement,
      usesExtension: true,
      updateKind: 'moddle-properties',
    };
  }

  return {
    ...context,
    descriptor: undefined,
    propertyName: getResolvedPropertyName(propertyName, undefined),
    target: context.businessObject,
    usesExtension: false,
    updateKind: 'properties',
  };
}

export function getProperty(elementOrBusinessObject: any, propertyName: string): any {
  const resolution = resolveProperty(elementOrBusinessObject, propertyName);

  if (!resolution.target || !resolution.propertyName) {
    return undefined;
  }

  if (typeof resolution.target.get === 'function') {
    return resolution.target.get(resolution.propertyName);
  }

  return resolution.target[resolution.propertyName];
}

export function setProperty(
  element: any,
  propertyName: string,
  value: any,
  modeling?: any,
): void {
  const resolution = resolveProperty(element, propertyName);

  if (!resolution.target || !resolution.propertyName) {
    return;
  }

  if (!modeling) {
    if (typeof resolution.target.set === 'function') {
      resolution.target.set(resolution.propertyName, value);
      return;
    }

    resolution.target[resolution.propertyName] = value;
    return;
  }

  if (resolution.updateKind === 'properties') {
    modeling.updateProperties(element, {
      [resolution.propertyName]: value,
    });
    return;
  }

  modeling.updateModdleProperties(element, resolution.target, {
    [resolution.propertyName]: value,
  });
}

export function createExtensionElement(
  businessObject: any,
  studyflowType: string,
  moddle: any,
  defaults: Record<string, any> = {}
): any {
  const descriptor = (() => {
    try { return moddle.getTypeDescriptor(studyflowType); }
    catch { return undefined; }
  })();
  const isExtendsOnly = (descriptor?.extends?.length ?? 0) > 0
    && (!descriptor?.superClass || descriptor.superClass.length === 0);

  if (isExtendsOnly) {
    for (const [propertyName, defaultValue] of Object.entries(defaults)) {
      setProperty(businessObject, propertyName, defaultValue);
    }
    return null;
  }

  let extensionElements = businessObject.extensionElements;

  if (!extensionElements) {
    extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    extensionElements.$parent = businessObject;
    businessObject.extensionElements = extensionElements;
  }

  const wrapper = moddle.create(studyflowType, {});
  wrapper.$parent = extensionElements;
  extensionElements.values.push(wrapper);

  for (const [propertyName, defaultValue] of Object.entries(defaults)) {
    setProperty(businessObject, propertyName, defaultValue);
  }

  return wrapper;
}

function toLocalName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(idx + 1);
}

export function getStudyflowDefaults(
  studyflowType: string,
  moddle: any
): Record<string, any> {
  const defaults: Record<string, any> = {};

  try {
    const descriptor = moddle.getTypeDescriptor(studyflowType);
    const properties = getEffectiveDescriptorProperties(descriptor, moddle);
    if (!properties.length) return defaults;

    for (const prop of properties) {
      if (prop.default !== undefined) {
        defaults[prop.name] = prop.default;
      }
    }
  } catch {
    // Type not found — return empty defaults
  }

  return defaults;
}

export function hasStudyflowExtends(element: any): boolean {
  const bo = element?.businessObject ?? element;
  return getEffectiveDescriptorProperties(bo, bo?.$model).some(
    (p: any) => isExtensionPrefix(p.ns?.prefix)
  ) ?? false;
}

