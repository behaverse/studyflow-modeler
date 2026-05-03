import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { toLocalName } from '../utils/naming';
import {
  getEffectivePropertyDescriptor,
  getExtensionPropertyDescriptor,
  getRedefinedPropertyName,
} from './descriptors';
import { getExtensionElement, hasExtends } from './wrapper';

export type ResolvedContext = {
  element: any | undefined;
  businessObject: any;
  extensionElement: any;
  hasExtends: boolean;
  hasWrapperExtension: boolean;
};

export type ResolvedProperty = ResolvedContext & {
  descriptor: any;
  propertyName: string | undefined;
  target: any;
  usesExtension: boolean;
  updateKind: 'properties' | 'moddle-properties';
};

export function resolveContext(elementOrBusinessObject: any): ResolvedContext {
  const businessObject = getBusinessObject(elementOrBusinessObject);
  const extensionElement = getExtensionElement(businessObject);

  return {
    element: elementOrBusinessObject?.businessObject ? elementOrBusinessObject : undefined,
    businessObject,
    extensionElement,
    hasExtends: hasExtends(businessObject),
    hasWrapperExtension: Boolean(extensionElement),
  };
}

function getResolvedPropertyName(propertyName: string | undefined, descriptor: any): string | undefined {
  if (propertyName === 'bpmn:id') return 'id';
  if (propertyName === 'bpmn:name') return 'name';

  return descriptor?.name
    ?? descriptor?.ns?.localName
    ?? toLocalName(propertyName);
}

export function resolveProperty(elementOrBusinessObject: any, propertyName: string): ResolvedProperty {
  const context = resolveContext(elementOrBusinessObject);
  const businessObjectDescriptor = getEffectivePropertyDescriptor(context.businessObject, propertyName);
  const extensionDescriptor = getExtensionPropertyDescriptor(context.extensionElement, propertyName);

  if (extensionDescriptor && context.extensionElement) {
    const redefinedPropertyName = getRedefinedPropertyName(extensionDescriptor);

    if (redefinedPropertyName && (businessObjectDescriptor || context.hasExtends)) {
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

  if (context.hasExtends) {
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

function readFrom(target: any, propertyName: string): any {
  if (!target) return undefined;
  if (typeof target.get === 'function') return target.get(propertyName);
  return target[propertyName];
}

export function getProperty(elementOrBusinessObject: any, propertyName: string): any {
  const resolution = resolveProperty(elementOrBusinessObject, propertyName);

  if (!resolution.target || !resolution.propertyName) return undefined;

  // When an extension wrapper type also declares the same property (e.g.
  // omniprocess:Map redefines `isDataOperation` with a pinned default of
  // `true`), moddle stores the value on the extension element — not on the BO.
  // Prefer the extension element's value when it has one so pinned schema
  // defaults are honored at runtime.
  if (resolution.extensionElement && resolution.target === resolution.businessObject) {
    const extDescriptor = getExtensionPropertyDescriptor(resolution.extensionElement, propertyName);
    if (extDescriptor) {
      const extPropertyName = extDescriptor.name ?? extDescriptor.ns?.localName ?? resolution.propertyName;
      const extValue = readFrom(resolution.extensionElement, extPropertyName);
      if (extValue !== undefined) return extValue;
    }
  }

  return readFrom(resolution.target, resolution.propertyName);
}

export function setProperty(
  element: any,
  propertyName: string,
  value: any,
  modeling?: any,
): void {
  const resolution = resolveProperty(element, propertyName);

  if (!resolution.target || !resolution.propertyName) return;

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
