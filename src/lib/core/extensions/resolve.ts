import type { AttributeSpec } from '../catalog';
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

function toBusinessObject(elementOrBO: any): any {
  return elementOrBO?.businessObject ?? elementOrBO;
}

function resolveName(name: string | undefined, attrDef: AttributeSpec | undefined): string | undefined {
  if (name === 'bpmn:id') return 'id';
  if (name === 'bpmn:name') return 'name';
  return attrDef?.name ?? attrDef?.ns?.localName ?? toLocalName(name);
}

function resolveAttribute(elementOrBO: any, attributeName: string): Resolved {
  const bo = toBusinessObject(elementOrBO);
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

/** Body-wrapped attribute (e.g. `cognitive:Configurations`): unwrap the value
 *  of the child element transparently. The body property is precompiled on
 *  the catalog spec, so no type-registry probing happens here. */
function unwrapBodyValue(rawValue: any, attrDef: AttributeSpec | undefined): any {
  if (!rawValue || typeof rawValue !== 'object' || !rawValue.$type) return rawValue;
  if (!attrDef?.bodyProp) return rawValue;
  const inner = read(rawValue, attrDef.bodyProp);
  return inner ?? '';
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
      if (extValue !== undefined) return unwrapBodyValue(extValue, extDef);
    }
  }

  const value = read(r.target, r.attributeName);
  const attrDef = getAttributeDefinition(r.target, r.attributeName);
  return unwrapBodyValue(value, attrDef);
}

export function setAttribute(element: any, attributeName: string, value: any, modeling?: any): void {
  const r = resolveAttribute(element, attributeName);
  if (!r.target || !r.attributeName) return;

  const attrDef = getAttributeDefinition(r.target, r.attributeName);
  const bodyProp = attrDef?.bodyProp;

  // Body-wrapped attribute: keep the wrapper instance and update its body.
  if (bodyProp && (typeof value === 'string' || value == null)) {
    const existing = read(r.target, r.attributeName);

    if (existing && typeof existing === 'object' && existing.$type) {
      if (!modeling) {
        if (typeof existing.set === 'function') existing.set(bodyProp, value ?? '');
        else existing[bodyProp] = value ?? '';
      } else {
        modeling.updateModdleProperties(element, existing, { [bodyProp]: value ?? '' });
      }
      return;
    }

    // Need a fresh wrapper of the declared type so writes survive
    // serialization; `$model` is the moddle codec attached to live elements.
    const model = r.target?.$model ?? r.bo?.$model;
    if (model && attrDef?.type) {
      value = model.create(attrDef.type, { [bodyProp]: value ?? '' });
    }
  }

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
