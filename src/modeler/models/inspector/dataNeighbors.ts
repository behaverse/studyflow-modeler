import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil';
import { getCatalog, isBpmnSubtypeOf } from '@/core/catalog';
import { getAttribute, StudyflowElement } from '@/core/extensions';

/** BPMN 2.0 data element kinds (frozen spec). Schema types count as data
 *  elements when their catalog `bpmnType` resolves into one of these.
 *  `bpmn:Property` belongs here too: it is an item-aware element like the
 *  rest, and the only difference is that it is never drawn. */
const DATA_BPMN_TYPES = [
  'bpmn:DataObject',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:DataInput',
  'bpmn:DataOutput',
  'bpmn:Property',
];

function isDataElement(element: any): boolean {
  if (!element) return false;
  if (DATA_BPMN_TYPES.some((t) => is(element, t))) return true;
  const bpmnType = getCatalog().bpmnTypeOf(StudyflowElement.fromBusinessObject(element).extensionType);
  return !!bpmnType && DATA_BPMN_TYPES.some((t) => isBpmnSubtypeOf(bpmnType, t));
}

function nameOf(element: any): string | undefined {
  const bo = getBusinessObject(element);
  return bo?.name || bo?.id || element?.id;
}

/** BPMN's own name for each data element kind, most specific first. */
const KIND_LABELS: Array<[string, string]> = [
  ['bpmn:Property', 'property'],
  ['bpmn:DataStoreReference', 'data store'],
  ['bpmn:DataStore', 'data store'],
  ['bpmn:DataObjectReference', 'data object'],
  ['bpmn:DataObject', 'data object'],
  ['bpmn:DataInput', 'data input'],
  ['bpmn:DataOutput', 'data output'],
];

function kindOf(element: any): string {
  for (const [type, label] of KIND_LABELS) if (is(element, type)) return label;
  return 'data';
}

export type DataNeighbor = {
  /** Display name of the wired data element. */
  name: string;
  /** `parameter` (inputs) / the native `transformation` expression (outputs)
   *  declared on the association; unset means the whole value flows, bound
   *  by the element's name. */
  binding?: string;
  /** True when the other end is a `bpmn:Property` — declared on an element and
   *  never drawn, so this is the only place its wire can be edited. */
  declared: boolean;
  /** BPMN's own name for the wired element: property, data object, data store. */
  kind: string;
  /** Id of the data association carrying this binding, so the inspector can
   *  edit or remove the wire it came from. */
  associationId?: string;
};

/**
 * An activity's inputs and outputs are not listed anywhere — they are the data
 * associations it carries.
 *
 * These are read from the business object rather than from canvas
 * connections, because only some of them are drawable. A wire to a data object
 * or store has a shape at both ends and renders; a wire to a `bpmn:Property`
 * has no shape to land on, since BPMN never draws properties. Reading the
 * semantic model shows both, so a step bound entirely to declared variables
 * still reports its data contract here instead of looking like it has none.
 */
export function getInferredDataNeighbors(
  element: any,
  direction: 'inputs' | 'outputs',
): DataNeighbor[] {
  const businessObject = getBusinessObject(element);
  const listName = direction === 'inputs' ? 'dataInputAssociations' : 'dataOutputAssociations';
  const associations: any[] = businessObject?.get?.(listName) ?? businessObject?.[listName] ?? [];
  const bindingAttr = direction === 'inputs' ? 'parameter' : 'transformation';

  return associations
    .flatMap((association: any) => {
      // BPMN gives an input association many sources and an output association
      // one target; the binding is declared once, on the association itself.
      const ends: any[] = direction === 'inputs'
        ? association?.sourceRef ?? []
        : [association?.targetRef].filter(Boolean);
      const raw = getAttribute(association, bindingAttr);
      const binding = (typeof raw === 'string' ? raw : raw?.body) || undefined;

      return ends
        .filter(isDataElement)
        .map((end: any) => ({
          name: nameOf(end),
          binding,
          declared: is(end, 'bpmn:Property'),
          kind: kindOf(end),
          associationId: association?.id,
        }));
    })
    .filter((n): n is DataNeighbor => !!n.name);
}
