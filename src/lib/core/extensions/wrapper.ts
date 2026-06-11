import { getActiveCatalog, type AttributeSpec } from '../catalog';
import { BPMN } from '../constants';
import { splitQName } from '../utils/naming';
import { isExtensionPrefix } from './attrs';
import { getAttributeDefinitions } from './attributeDefinitions';
import { setAttribute } from './resolve';

function toBusinessObject(elementOrBO: any): any {
  return elementOrBO?.businessObject ?? elementOrBO;
}

/** First non-core extension wrapper on `<bpmn:extensionElements>`, or null. */
export function getExtensionElement(elementOrBO: any): any {
  const bo = toBusinessObject(elementOrBO);
  const values = bo?.extensionElements?.values;
  if (!values) return null;
  return values.find((ext: any) => isExtensionPrefix(splitQName(ext.$type).prefix)) ?? null;
}

/** Attribute definitions declared on this element's extension wrapper, if any. */
export function getExtensionAttributeDefinitions(elementOrBO: any): AttributeSpec[] {
  const ext = getExtensionElement(elementOrBO);
  return ext ? getAttributeDefinitions(ext) : [];
}

/** Adds a wrapper inside `<bpmn:extensionElements>`; trait types write defaults straight to the BO. */
export function createExtensionElement(
  bo: any,
  extensionType: string,
  moddle: any,
  defaults: Record<string, any> = {},
): any {
  const entry = getActiveCatalog().getType(extensionType);

  if (entry?.style === 'trait') {
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

/** True when extension attributes are mixed onto the BO via schema traits. */
export function hasExtends(element: any): boolean {
  const bo = toBusinessObject(element);
  return getAttributeDefinitions(bo).some((spec) => isExtensionPrefix(spec.ns?.prefix));
}
