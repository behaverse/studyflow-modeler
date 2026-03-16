/**
 * Helper utilities for reading/writing studyflow extension elements
 * in the BPMN extensionElements container.
 *
 * Standalone version — no bpmn-js dependency.
 */

import { getBusinessObject } from './businessObject';
import { resolveBpmnCreateType } from './moddle/resolveBpmnType';

export const CORE_PREFIXES = new Set([
  'bpmn',
  'bpmndi',
  'dc',
  'di',
  'xsi',
  'xml'
]);

const APPLIED_TYPE_ATTR_LOCAL_NAME = 'appliedType';
const IGNORED_INFERENCE_DEFAULTS = new Set(['id', 'name', 'documentation']);

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

export function setNamespacedAttr(target: any, attrName: string, value: any): void {
  if (!target || value === undefined) {
    return;
  }

  if (typeof target.set === 'function') {
    try {
      target.set(attrName, value);
      return;
    } catch {
      // Fall through to direct $attrs mutation when supported.
    }
  }

  const attrs = target.$attrs;
  if (attrs && typeof attrs === 'object') {
    attrs[attrName] = value;
  }
}

export function setAppliedStudyflowType(target: any, studyflowType: string | undefined): void {
  if (!studyflowType) {
    return;
  }

  const prefix = studyflowType.split(':')[0];
  setNamespacedAttr(target, `${prefix}:${APPLIED_TYPE_ATTR_LOCAL_NAME}`, studyflowType);
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

function getCandidateInferenceDefaults(descriptor: any): Record<string, any> {
  const defaults: Record<string, any> = {};

  for (const property of descriptor?.properties ?? []) {
    if (
      property?.default !== undefined
      && !IGNORED_INFERENCE_DEFAULTS.has(property.name)
    ) {
      defaults[property.name] = property.default;
    }
  }

  return defaults;
}

function valuesMatch(left: any, right: any): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  if (left && right && typeof left === 'object' && typeof right === 'object') {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  return false;
}

function inferAppliedStudyflowType(elementOrBusinessObject: any): string | undefined {
  const businessObject = getBusinessObject(elementOrBusinessObject);
  const model = businessObject?.$model;
  const typeMap: Record<string, any> = model?.registry?.typeMap ?? {};
  const bpmnType = businessObject?.$type;

  if (!businessObject || !model || !bpmnType) {
    return undefined;
  }

  let bestMatch: { typeName: string; score: number } | undefined;

  for (const [typeName, descriptor] of Object.entries(typeMap)) {
    if (!typeName.includes(':')) {
      continue;
    }

    const prefix = descriptor?.ns?.prefix ?? typeName.split(':')[0];
    if (!isExtensionPrefix(prefix) || descriptor?.isAbstract) {
      continue;
    }

    if (!isExtendsType(typeName, model)) {
      continue;
    }

    if (resolveBpmnCreateType(model, descriptor) !== bpmnType) {
      continue;
    }

    const defaults = getCandidateInferenceDefaults(descriptor);
    const entries = Object.entries(defaults);
    if (entries.length === 0) {
      continue;
    }

    const matchesAllDefaults = entries.every(([propertyName, defaultValue]) => {
      const currentValue = getProperty(businessObject, propertyName);
      return valuesMatch(currentValue, defaultValue);
    });

    if (!matchesAllDefaults) {
      continue;
    }

    const score = entries.length;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { typeName, score };
    }
  }

  return bestMatch?.typeName;
}

export function getAppliedStudyflowType(elementOrBusinessObject: any): string | undefined {
  const extensionElement = getExtensionElement(elementOrBusinessObject);
  if (extensionElement?.$type) {
    return extensionElement.$type;
  }

  const businessObject = getBusinessObject(elementOrBusinessObject);
  const appliedType = getNamespacedAttrValue(businessObject, APPLIED_TYPE_ATTR_LOCAL_NAME);
  if (appliedType) {
    return appliedType;
  }

  return inferAppliedStudyflowType(businessObject);
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

export function isExtendsType(studyflowType: string, moddle: any): boolean {
  try {
    const descriptor = moddle.getTypeDescriptor(studyflowType);
    return (descriptor?.extends?.length ?? 0) > 0 || Boolean(descriptor?.meta?.exampleScopedExtends);
  } catch {
    return false;
  }
}
