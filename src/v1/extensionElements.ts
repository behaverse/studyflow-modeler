/**
 * Helper utilities for reading/writing studyflow extension elements
 * in the BPMN extensionElements container.
 *
 * Studyflow data is stored as wrapper extension elements, e.g.:
 *   <bpmn2:extensionElements>
 *     <studyflow:...
 *   </bpmn2:extensionElements>
 */

import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';

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

/**
 * Create an extension element on a business object (for use during
 * element creation, before the element is added to the canvas).
 * Does NOT use modeling commands (no undo/redo needed for creation).
 */
export function createExtensionElement(
  businessObject: any,
  studyflowType: string,
  moddle: any,
  defaults: Record<string, any> = {}
): any {
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

/**
 * Resolve default property values for a studyflow type from the moddle schema.
 */
export function getStudyflowDefaults(
  studyflowType: string,
  moddle: any
): Record<string, any> {
  const defaults: Record<string, any> = {};

  try {
    const descriptor = moddle.getTypeDescriptor(studyflowType);
    if (!descriptor?.properties) return defaults;

    for (const prop of descriptor.properties) {
      if (prop.default !== undefined) {
        defaults[prop.name] = prop.default;
      }
    }
  } catch {
    // Type not found — return empty defaults
  }

  return defaults;
}

/**
 * Check if a BPMN element has studyflow properties mixed in via the
 * moddle `extends` mechanism (as opposed to extension elements).
 * This is the case for StartEvent / EndEvent whose studyflow properties
 * are XML attributes on the BPMN element itself.
 */
export function hasStudyflowExtends(element: any): boolean {
  const bo = element?.businessObject ?? element;
  return getEffectiveDescriptorProperties(bo, bo?.$model).some(
    (p: any) => isExtensionPrefix(p.ns?.prefix)
  ) ?? false;
}

/**
 * Check if a studyflow type uses `extends` (properties on the BPMN element)
 * vs. standalone extension elements.
 */
export function isExtendsType(studyflowType: string, moddle: any): boolean {
  try {
    const descriptor = moddle.getTypeDescriptor(studyflowType);
    return (descriptor?.extends?.length ?? 0) > 0 || Boolean(descriptor?.meta?.exampleScopedExtends);
  } catch {
    return false;
  }
}
