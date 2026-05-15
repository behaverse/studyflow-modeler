import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { BPMN } from '../constants';
import { splitQName } from '../utils/naming';
import { isExtensionPrefix } from './attrs';
import { getEffectiveDescriptorProperties } from './descriptors';
import { setProperty } from './resolve';

// First non-core extension wrapper on `<bpmn:extensionElements>`, or null.
export function getExtensionElement(elementOrBO: any): any {
  const bo = getBusinessObject(elementOrBO);
  const values = bo?.extensionElements?.values;
  if (!values) return null;
  return values.find((ext: any) => isExtensionPrefix(splitQName(ext.$type).prefix)) ?? null;
}

export function getExtensionElementProperties(elementOrBO: any): any[] {
  const ext = getExtensionElement(elementOrBO);
  return getEffectiveDescriptorProperties(ext, ext?.$model);
}

// Create an extension wrapper on a BO during element creation (pre-canvas).
// For `extends:`-style types, defaults are written directly onto the BO and
// no wrapper is added (bpmn-moddle cannot create extends-only types standalone).
export function createExtensionElement(
  businessObject: any,
  studyflowType: string,
  moddle: any,
  defaults: Record<string, any> = {},
): any {
  let descriptor: any;
  try { descriptor = moddle.getTypeDescriptor(studyflowType); } catch { /* */ }

  const isExtendsOnly = (descriptor?.extends?.length ?? 0) > 0
    && (!descriptor?.superClass || descriptor.superClass.length === 0);

  if (isExtendsOnly) {
    for (const [name, value] of Object.entries(defaults)) {
      setProperty(businessObject, name, value);
    }
    return null;
  }

  if (!businessObject.extensionElements) {
    const ext = moddle.create(BPMN.ExtensionElements, { values: [] });
    ext.$parent = businessObject;
    businessObject.extensionElements = ext;
  }

  const wrapper = moddle.create(studyflowType, {});
  wrapper.$parent = businessObject.extensionElements;
  businessObject.extensionElements.values.push(wrapper);

  for (const [name, value] of Object.entries(defaults)) {
    setProperty(businessObject, name, value);
  }

  return wrapper;
}

// True if extension properties are mixed onto the BO via moddle `extends`
// (e.g. StartEvent / EndEvent) rather than nested in an extension element.
export function hasExtends(element: any): boolean {
  const bo = element?.businessObject ?? element;
  return getEffectiveDescriptorProperties(bo, bo?.$model)
    .some((p: any) => isExtensionPrefix(p.ns?.prefix));
}
