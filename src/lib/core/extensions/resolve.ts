import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { toLocalName } from '../utils/naming';
import { getAttributeDefinition, getRedefinedName } from './attributeDefinitions';
import { getExtensionElement, hasExtends } from './wrapper';

type Resolved = {
  bo: any;
  ext: any;
  attributeName: string | undefined;
  target: any;
  targetKind: 'business-object' | 'extension-element';
};

function resolveName(name: string | undefined, attrDef: any): string | undefined {
  if (name === 'bpmn:id') return 'id';
  if (name === 'bpmn:name') return 'name';
  return attrDef?.name ?? attrDef?.ns?.localName ?? toLocalName(name);
}

function resolveAttribute(elementOrBO: any, attributeName: string): Resolved {
  const bo = getBusinessObject(elementOrBO);
  const ext = getExtensionElement(bo);
  const boDef = getAttributeDefinition(bo, attributeName);
  const extDef = getAttributeDefinition(ext, attributeName);

  // Extension redefines a BO attribute -> write under the redefined name.
  if (extDef && ext) {
    const redefined = getRedefinedName(extDef);
    if (redefined && (boDef || hasExtends(bo))) {
      return { bo, ext, attributeName: redefined, target: bo, targetKind: 'business-object' };
    }
  }

  if (boDef) {
    return {
      bo, ext,
      attributeName: resolveName(attributeName, boDef),
      target: bo,
      targetKind: 'business-object',
    };
  }

  if (extDef && ext) {
    return {
      bo, ext,
      attributeName: resolveName(attributeName, extDef),
      target: ext,
      targetKind: 'extension-element',
    };
  }

  // Unknown attribute: pick a target that won't silently drop the write.
  const useExt = !!ext && !hasExtends(bo);
  return {
    bo, ext,
    attributeName: resolveName(attributeName, undefined),
    target: useExt ? ext : bo,
    targetKind: useExt ? 'extension-element' : 'business-object',
  };
}

function read(target: any, name: string): any {
  if (!target) return undefined;
  return typeof target.get === 'function' ? target.get(name) : target[name];
}

export function getAttribute(elementOrBO: any, attributeName: string): any {
  const r = resolveAttribute(elementOrBO, attributeName);
  if (!r.target || !r.attributeName) return undefined;

  // Pinned defaults on the wrapper take precedence over the BO value.
  if (r.ext && r.target === r.bo) {
    const extDef = getAttributeDefinition(r.ext, attributeName);
    if (extDef) {
      const extName = extDef.name ?? extDef.ns?.localName ?? r.attributeName;
      const extValue = read(r.ext, extName);
      if (extValue !== undefined) return extValue;
    }
  }

  return read(r.target, r.attributeName);
}

export function setAttribute(element: any, attributeName: string, value: any, modeling?: any): void {
  const r = resolveAttribute(element, attributeName);
  if (!r.target || !r.attributeName) return;

  if (!modeling) {
    if (typeof r.target.set === 'function') r.target.set(r.attributeName, value);
    else r.target[r.attributeName] = value;
    return;
  }

  if (r.targetKind === 'business-object') {
    modeling.updateProperties(element, { [r.attributeName]: value });
  } else {
    modeling.updateModdleProperties(element, r.target, { [r.attributeName]: value });
  }
}
