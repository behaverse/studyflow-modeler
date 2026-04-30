import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { BPMN } from '../constants/bpmn';
import { splitQName } from '../utils/naming';
import { isExtensionPrefix } from './attrs';
import { getEffectiveDescriptorProperties } from './descriptors';
import { setProperty } from './resolve';

/**
 * Get the first extension element wrapper from a BPMN element or an
 * already-resolved business object. Returns null if none exists.
 */
export function getExtensionElement(elementOrBusinessObject: any): any {
  const bo = getBusinessObject(elementOrBusinessObject);
  const values = bo?.extensionElements?.values;
  if (!values) return null;

  return values.find((ext: any) =>
    isExtensionPrefix(splitQName(ext.$type).prefix)
  ) ?? null;
}

export function getExtensionElementProperties(elementOrBusinessObject: any): any[] {
  const extensionElement = getExtensionElement(elementOrBusinessObject);
  return getEffectiveDescriptorProperties(extensionElement, extensionElement?.$model);
}

/**
 * Create an extension element on a business object during element creation
 * (before the element is added to the canvas). Skips modeling commands —
 * undo/redo isn't needed before first render.
 *
 * For `extends:`-style types (properties already live on the BPMN BO via
 * moddle extends, and bpmn-moddle cannot create them standalone), defaults
 * are applied directly to the BO and no wrapper is added.
 */
export function createExtensionElement(
  businessObject: any,
  studyflowType: string,
  moddle: any,
  defaults: Record<string, any> = {},
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
    extensionElements = moddle.create(BPMN.ExtensionElements, { values: [] });
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

/**
 * True if a BPMN element has extension properties mixed in via the moddle
 * `extends` mechanism (properties live directly on the BPMN element, e.g.
 * StartEvent / EndEvent), as opposed to being nested in an extension element.
 */
export function hasExtends(element: any): boolean {
  const bo = element?.businessObject ?? element;
  return getEffectiveDescriptorProperties(bo, bo?.$model).some(
    (p: any) => isExtensionPrefix(p.ns?.prefix),
  ) ?? false;
}

