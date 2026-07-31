import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil';
import { getCatalog, isBpmnSubtypeOf } from '@/core/catalog';
import { StudyflowElement } from '@/core/extensions';

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
  /** Display name of the associated data element. */
  name: string;
  /** The association's transformation body (`slot = selection`, each half optional);
   *  unset means the whole value flows, bound by the element's name. */
  binding?: string;
  /** True when the other end is a `bpmn:Property` — declared on an element and
   *  never drawn, so this is the only place its association can be edited. */
  declared: boolean;
  /** BPMN's own name for the associated element: property, data object, data store. */
  kind: string;
  /** Name of the container declaring the element, when that is not the step's
   *  own — the association then reaches out of this plane and cannot be drawn. Unset
   *  for the ordinary case of a sibling on the same canvas. */
  outerScope?: string;
  /** Id of the data association carrying this binding, so the inspector can
   *  edit or remove the association it came from. */
  associationId?: string;
};

/** The process or sub-process an element is declared in. */
function containerOf(element: any): any {
  let node = getBusinessObject(element)?.$parent;
  while (node && !is(node, 'bpmn:Process') && !is(node, 'bpmn:SubProcess')) node = node.$parent;
  return node;
}

/**
 * Where a associated element sits relative to the step, when that is worth saying.
 *
 * BPMN resolves a data association outward through the containers around a step
 * (§10.4.7), so a task inside a sub-process may legitimately read a data object
 * declared by the process around it. What it may *not* do is show that association:
 * DI draws a collapsed sub-process as one shape on its parent's plane and gives
 * its contents a plane of their own, and an edge cannot span two planes. The
 * association is real, the binding is real, and there is nowhere to draw it —
 * so the inspector names the scope instead of listing a neighbour the reader
 * then looks for on a canvas that will never have it.
 */
function outerScopeOf(element: any, dataElement: any): string | undefined {
  const owner = containerOf(dataElement);
  if (!owner || owner === containerOf(element)) return undefined;
  return owner.name || owner.id;
}

/**
 * Whether BPMN gives this element the association list at all, asked of the
 * metamodel rather than of a list kept here.
 *
 * The answer is asymmetric and worth honouring: a task has both lists, a start
 * event only outputs (it produces what the process starts with), an end event
 * only inputs, and a process or gateway neither. Offering a group the element
 * cannot have invites a binding the file has nowhere to put.
 */
export function supportsDataAssociations(element: any, direction: 'inputs' | 'outputs'): boolean {
  const listName = direction === 'inputs' ? 'dataInputAssociations' : 'dataOutputAssociations';
  const properties: any[] = getBusinessObject(element)?.$descriptor?.properties ?? [];
  return properties.some((property: any) => property?.name === listName);
}

/**
 * An activity's inputs and outputs are not listed anywhere — they are the data
 * associations it carries.
 *
 * These are read from the business object rather than from canvas
 * connections, because only some of them are drawable. A data association to a data object
 * or store has a shape at both ends and renders; a data association to a `bpmn:Property`
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

  return associations
    .flatMap((association: any) => {
      // BPMN gives an input association many sources and an output association
      // one target; the binding is declared once, on the association itself.
      const ends: any[] = direction === 'inputs'
        ? association?.sourceRef ?? []
        : [association?.targetRef].filter(Boolean);
      const expression = association.get?.('transformation') ?? association.transformation;
      const raw = expression?.get?.('body') ?? expression?.body;
      const binding = (typeof raw === 'string' ? raw : undefined) || undefined;

      return ends
        .filter(isDataElement)
        .filter((end: any) => !!nameOf(end))
        .map((end: any): DataNeighbor => ({
          name: nameOf(end) as string,
          binding,
          declared: is(end, 'bpmn:Property'),
          kind: kindOf(end),
          // A property is never drawn wherever it lives, so its scope is the
          // State tab's business; this is only about elements with a shape.
          outerScope: is(end, 'bpmn:Property') ? undefined : outerScopeOf(element, end),
          associationId: association?.id,
        }));
    });
}
