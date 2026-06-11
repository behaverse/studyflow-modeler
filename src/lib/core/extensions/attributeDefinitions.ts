import { getActiveCatalog, type AttributeSpec } from '../catalog';
import { toLocalName } from '../utils/naming';

/** bpmn-js elements carry the moddle object on `businessObject`. */
function toBusinessObject(elementOrBO: any): any {
  return elementOrBO?.businessObject ?? elementOrBO;
}

function typeNameOf(elementOrType: any): string | undefined {
  if (typeof elementOrType === 'string') return elementOrType;
  const target = toBusinessObject(elementOrType);
  return target?.$type ?? target?.ns?.name;
}

/** BPMN-native identity attributes, addressable as `bpmn:id`/`bpmn:name`. */
const BPMN_NATIVE_SPECS: Record<string, AttributeSpec> = {
  id: {
    name: 'id',
    ns: { name: 'bpmn:id', prefix: 'bpmn', localName: 'id' },
    type: 'String',
    isAttr: true,
    isId: true,
  },
  name: {
    name: 'name',
    ns: { name: 'bpmn:name', prefix: 'bpmn', localName: 'name' },
    type: 'String',
    isAttr: true,
  },
};

/** All schema-defined attributes for this element/type (BPMN natives excluded). */
export function getAttributeDefinitions(elementOrType: any): AttributeSpec[] {
  return getActiveCatalog().instanceAttributesOf(typeNameOf(elementOrType));
}

/** Definition for a single named attribute, including the bpmn:id/bpmn:name pair. */
export function getAttributeDefinition(elementOrBO: any, name: string | undefined): AttributeSpec | undefined {
  if (!name) return undefined;
  const spec = getActiveCatalog().attributeOf(typeNameOf(elementOrBO), name);
  if (spec) return spec;
  const local = toLocalName(name);
  return local ? BPMN_NATIVE_SPECS[local] : undefined;
}

/** Local name of the attribute this definition overrides via `redefines:` or `replaces:`. */
export function getRedefinedName(attrDef: AttributeSpec | undefined): string | undefined {
  return attrDef?.redefinedName;
}
