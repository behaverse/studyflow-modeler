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
import { executeCommand } from './commands';

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

/**
 * Get the studyflow extension element wrapper when present,
 * otherwise fall back to the BPMN business object itself.
 */
export function getExtensionElementOrBusinessObject(elementOrBusinessObject: any): any {
  const bo = getBusinessObject(elementOrBusinessObject);
  return getExtensionElement(bo) ?? bo;
}

/**
 * Get the value of a property from the studyflow extension element.
 * @param element - The diagram element or business object
 * @param propertyName - The property name, optionally prefixed (e.g., "instrument" or "studyflow:instrument")
 */
export function getExtensionProperty(element: any, propertyName: string): any {
  const ext = getExtensionElement(element);
  if (!ext) return undefined;
  return ext.get(propertyName);
}

/**
 * Set a property on the studyflow extension element using proper modeling commands.
 * This fires the correct bpmn-js events for undo/redo support.
 */
export function setExtensionProperty(
  element: any,
  propertyName: string,
  value: any,
  modeling: any
): void {
  executeCommand(modeling, {
    type: 'update-property',
    element,
    propertyName,
    value,
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

  const wrapper = moddle.create(studyflowType, defaults);
  wrapper.$parent = extensionElements;
  extensionElements.values.push(wrapper);

  // If defaults define a property that also exists as a custom extends-based
  // prop on the BPMN business object (possibly under a different schema prefix),
  // mirror the default onto the BO property so runtime/inspector stay consistent.
  const boProps: any[] = businessObject?.$descriptor?.properties ?? [];
  const toLocalName = (name: string | undefined): string | undefined => {
    if (!name) return undefined;
    const idx = name.indexOf(':');
    return idx === -1 ? name : name.slice(idx + 1);
  };

  for (const [defaultKey, defaultValue] of Object.entries(defaults)) {
    const localName = toLocalName(defaultKey);
    if (!localName) continue;

    const matchingBoProp = boProps.find((prop: any) => {
      const nsName = prop?.ns?.name as string | undefined;
      const nsPrefix = prop?.ns?.prefix as string | undefined;
      if (!isExtensionPrefix(nsPrefix)) return false;
      return toLocalName(nsName) === localName;
    });

    if (!matchingBoProp) continue;

    const boPropName = (matchingBoProp?.ns?.name as string | undefined) ?? localName;
    if (typeof businessObject?.set === 'function') {
      businessObject.set(boPropName, defaultValue);
    } else {
      businessObject[localName] = defaultValue;
    }
  }

  return wrapper;
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
 * Check if a property condition is met based on the studyflow extension element.
 * Conditions reference property names like "studyflow:requiresConsent".
 */
export function isConditionMet(
  condition: { body: Record<string, any> } | undefined,
  extensionElement: any
): boolean {
  if (!condition?.body || !extensionElement) return true;

  return Object.entries(condition.body).every(([key, expectedValue]) => {
    const value = extensionElement.get(key);
    return value === expectedValue;
  });
}

/**
 * Check if a BPMN element has studyflow properties mixed in via the
 * moddle `extends` mechanism (as opposed to extension elements).
 * This is the case for StartEvent / EndEvent whose studyflow properties
 * are XML attributes on the BPMN element itself.
 */
export function hasStudyflowExtends(element: any): boolean {
  const bo = element?.businessObject ?? element;
  return bo?.$descriptor?.properties?.some(
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
