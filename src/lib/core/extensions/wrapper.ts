import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { BPMN } from '../constants';
import { splitQName } from '../utils/naming';
import { isExtensionPrefix } from './attrs';
import { getAttributeDefinitions } from './attributeDefinitions';
import { setAttribute } from './resolve';

/** First non-core extension wrapper on `<bpmn:extensionElements>`, or null. */
export function getExtensionElement(elementOrBO: any): any {
  const bo = getBusinessObject(elementOrBO);
  const values = bo?.extensionElements?.values;
  if (!values) return null;
  return values.find((ext: any) => isExtensionPrefix(splitQName(ext.$type).prefix)) ?? null;
}

/** Attribute definitions declared on this element's extension wrapper, if any. */
export function getExtensionAttributeDefinitions(elementOrBO: any): any[] {
  const ext = getExtensionElement(elementOrBO);
  return getAttributeDefinitions(ext, ext?.$model);
}

/** Adds a wrapper inside `<bpmn:extensionElements>`; `extends:`-style types write defaults straight to the BO. */
export function createExtensionElement(
  bo: any,
  extensionType: string,
  moddle: any,
  defaults: Record<string, any> = {},
): any {
  let typeDef: any;
  try { typeDef = moddle.getTypeDescriptor(extensionType); } catch { /* unknown type */ }

  const isExtendsOnly = (typeDef?.extends?.length ?? 0) > 0
    && (!typeDef?.superClass || typeDef.superClass.length === 0);

  if (isExtendsOnly) {
    for (const [name, value] of Object.entries(defaults)) {
      setAttribute(bo, name, value);
    }
    return null;
  }

  if (!bo.extensionElements) {
    const ext = moddle.create(BPMN.ExtensionElements, { values: [] });
    ext.$parent = bo;
    bo.extensionElements = ext;
  }

  const wrapper = moddle.create(extensionType, {});
  wrapper.$parent = bo.extensionElements;
  bo.extensionElements.values.push(wrapper);

  for (const [name, value] of Object.entries(defaults)) {
    setAttribute(bo, name, value);
  }

  return wrapper;
}

/** True when extension attributes are mixed onto the BO via moddle `extends`. */
export function hasExtends(element: any): boolean {
  const bo = element?.businessObject ?? element;
  return getAttributeDefinitions(bo, bo?.$model)
    .some((attrDef: any) => isExtensionPrefix(attrDef.ns?.prefix));
}
