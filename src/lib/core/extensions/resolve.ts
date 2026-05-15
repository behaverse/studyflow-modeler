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

export function resolveContext(elementOrBO: any): ResolvedContext {
  const businessObject = getBusinessObject(elementOrBO);
  const extensionElement = getExtensionElement(businessObject);
  return {
    element: elementOrBO?.businessObject ? elementOrBO : undefined,
    businessObject,
    extensionElement,
    hasExtends: hasExtends(businessObject),
    hasWrapperExtension: !!extensionElement,
  };
}

function resolveName(name: string | undefined, descriptor: any): string | undefined {
  if (name === 'bpmn:id') return 'id';
  if (name === 'bpmn:name') return 'name';
  return descriptor?.name ?? descriptor?.ns?.localName ?? toLocalName(name);
}

export function resolveProperty(elementOrBO: any, propertyName: string): ResolvedProperty {
  const ctx = resolveContext(elementOrBO);
  const boDescriptor = getEffectivePropertyDescriptor(ctx.businessObject, propertyName);
  const extDescriptor = getExtensionPropertyDescriptor(ctx.extensionElement, propertyName);

  // Extension redefines a BO property → write to the BO under the redefined name.
  if (extDescriptor && ctx.extensionElement) {
    const redefined = getRedefinedPropertyName(extDescriptor);
    if (redefined && (boDescriptor || ctx.hasExtends)) {
      return {
        ...ctx,
        descriptor: extDescriptor,
        propertyName: redefined,
        target: ctx.businessObject,
        usesExtension: false,
        updateKind: 'properties',
      };
    }
  }

  if (boDescriptor) {
    return {
      ...ctx,
      descriptor: boDescriptor,
      propertyName: resolveName(propertyName, boDescriptor),
      target: ctx.businessObject,
      usesExtension: false,
      updateKind: 'properties',
    };
  }

  if (extDescriptor && ctx.extensionElement) {
    return {
      ...ctx,
      descriptor: extDescriptor,
      propertyName: resolveName(propertyName, extDescriptor),
      target: ctx.extensionElement,
      usesExtension: true,
      updateKind: 'moddle-properties',
    };
  }

  // Unknown property — pick a sensible target so writes don't silently drop.
  const target = ctx.hasExtends || !ctx.extensionElement ? ctx.businessObject : ctx.extensionElement;
  return {
    ...ctx,
    descriptor: undefined,
    propertyName: resolveName(propertyName, undefined),
    target,
    usesExtension: target === ctx.extensionElement,
    updateKind: target === ctx.extensionElement ? 'moddle-properties' : 'properties',
  };
}

function read(target: any, name: string): any {
  if (!target) return undefined;
  return typeof target.get === 'function' ? target.get(name) : target[name];
}

export function getProperty(elementOrBO: any, propertyName: string): any {
  const r = resolveProperty(elementOrBO, propertyName);
  if (!r.target || !r.propertyName) return undefined;

  // When the wrapper redefines a BO property (e.g. omniprocess:Map pinning
  // `isDataOperation: true`), moddle stores the value on the wrapper. Prefer
  // the wrapper value so pinned schema defaults are honored.
  if (r.extensionElement && r.target === r.businessObject) {
    const extDesc = getExtensionPropertyDescriptor(r.extensionElement, propertyName);
    if (extDesc) {
      const extName = extDesc.name ?? extDesc.ns?.localName ?? r.propertyName;
      const extValue = read(r.extensionElement, extName);
      if (extValue !== undefined) return extValue;
    }
  }

  return read(r.target, r.propertyName);
}

export function setProperty(element: any, propertyName: string, value: any, modeling?: any): void {
  const r = resolveProperty(element, propertyName);
  if (!r.target || !r.propertyName) return;

  if (!modeling) {
    if (typeof r.target.set === 'function') r.target.set(r.propertyName, value);
    else r.target[r.propertyName] = value;
    return;
  }

  if (r.updateKind === 'properties') {
    modeling.updateProperties(element, { [r.propertyName]: value });
  } else {
    modeling.updateModdleProperties(element, r.target, { [r.propertyName]: value });
  }
}
