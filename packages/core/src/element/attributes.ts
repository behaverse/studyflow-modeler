import { getCatalog, type AttributeSpec } from '@core/notation';
import { toLocalName } from '@core/naming';

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

/** The spec of the attribute `name` an element of `type` takes. */
export function getAttributeSpec(type: string | undefined, name: string | undefined): AttributeSpec | undefined {
  if (!name) return undefined;
  const spec = getCatalog().attributeOf(type, name);
  if (spec) return spec;
  const local = toLocalName(name);
  return local ? BPMN_NATIVE_SPECS[local] : undefined;
}
