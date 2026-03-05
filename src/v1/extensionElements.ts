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

const CORE_PREFIXES = new Set([
  'bpmn',
  'bpmndi',
  'dc',
  'di',
  'xsi',
  'xml',
  'camunda',
  'zeebe',
  'flowable'
]);

export function isCustomSchemaPrefix(prefix: string | undefined): boolean {
  return Boolean(prefix && !CORE_PREFIXES.has(prefix));
}

/**
 * Get the studyflow extension element wrapper from a BPMN element.
 * Returns the first studyflow-namespaced extension element found, or null.
 */
export function getStudyflowExtension(element: any): any {
  const bo = element?.businessObject ?? element;
  const values = bo?.extensionElements?.values;
  if (!values) return null;

  return values.find((ext: any) =>
    isCustomSchemaPrefix(ext.$type?.split(':')?.[0])
  ) ?? null;
}

/**
 * Get the studyflow extension type name (e.g. "studyflow:CognitiveTask").
 */
export function getStudyflowType(element: any): string | null {
  const ext = getStudyflowExtension(element);
  return ext?.$type ?? null;
}

/**
 * Get the property descriptors for the studyflow extension element.
 * These are the moddle property descriptors, including inherited metadata
 * like categories, conditions, defaults, etc.
 */
export function getStudyflowProperties(element: any): any[] {
  const ext = getStudyflowExtension(element);
  if (!ext?.$descriptor) return [];
  return ext.$descriptor.properties ?? [];
}

/**
 * Get the value of a property from the studyflow extension element.
 * @param element - The diagram element or business object
 * @param propertyName - The property name, optionally prefixed (e.g., "instrument" or "studyflow:instrument")
 */
export function getExtensionProperty(element: any, propertyName: string): any {
  const ext = getStudyflowExtension(element);
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
    type: 'update-extension-property',
    element,
    propertyName,
    value,
  });
}

/**
 * Ensure a studyflow extension element exists on the given BPMN element.
 * Creates the ExtensionElements container and wrapper if needed.
 *
 * @param element - The diagram element
 * @param studyflowType - The studyflow type (e.g., "studyflow:CognitiveTask")
 * @param moddle - The moddle instance
 * @param modeling - The modeling service
 * @param defaults - Optional default property values to set
 * @returns The studyflow extension element wrapper
 */
export function ensureStudyflowExtension(
  element: any,
  studyflowType: string,
  moddle: any,
  modeling: any,
  defaults: Record<string, any> = {}
): any {
  const bo = getBusinessObject(element);
  let extensionElements = bo.extensionElements;

  // Create ExtensionElements container if needed
  if (!extensionElements) {
    extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    extensionElements.$parent = bo;
  }

  // Find or create the wrapper
  let wrapper = extensionElements.values.find(
    (ext: any) => ext.$type === studyflowType
  );

  if (!wrapper) {
    wrapper = moddle.create(studyflowType, defaults);
    wrapper.$parent = extensionElements;
    extensionElements.values.push(wrapper);

    // Update the element to include the new extensionElements
    executeCommand(modeling, {
      type: 'update-properties',
      element,
      properties: { extensionElements },
    });
  }

  return wrapper;
}

/**
 * Create a studyflow extension element on a business object (for use during
 * element creation, before the element is added to the canvas).
 * Does NOT use modeling commands (no undo/redo needed for creation).
 */
export function createStudyflowExtension(
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
      if (!isCustomSchemaPrefix(nsPrefix)) return false;
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
    (p: any) => isCustomSchemaPrefix(p.ns?.prefix)
  ) ?? false;
}

/**
 * Check if a studyflow type uses `extends` (properties on the BPMN element)
 * vs. standalone extension elements.
 */
export function isExtendsType(studyflowType: string, moddle: any): boolean {
  try {
    const descriptor = moddle.getTypeDescriptor(studyflowType);
    return (descriptor?.extends?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
