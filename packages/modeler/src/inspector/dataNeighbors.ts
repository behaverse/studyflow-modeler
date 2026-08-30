import { getBusinessObject, is } from '@modeler/editor/port';
import { getCatalog, isBpmnSubtypeOf } from '@core/notation';
import { StudyflowElement } from '@core/element';

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
  name: string;
  /** The association's transformation body (`slot = selection`, each half optional); unset means the whole value flows. */
  binding?: string;
  /** True when the other end is a never-drawn `bpmn:Property`, whose association is editable only here. */
  declared: boolean;
  kind: string;
  outerScope?: string;
  associationId?: string;
};

function containerOf(element: any): any {
  let node = getBusinessObject(element)?.$parent;
  while (node && !is(node, 'bpmn:Process') && !is(node, 'bpmn:SubProcess')) node = node.$parent;
  return node;
}

function outerScopeOf(element: any, dataElement: any): string | undefined {
  const owner = containerOf(dataElement);
  if (!owner || owner === containerOf(element)) return undefined;
  return owner.name || owner.id;
}

export function supportsDataAssociations(element: any, direction: 'inputs' | 'outputs'): boolean {
  const listName = direction === 'inputs' ? 'dataInputAssociations' : 'dataOutputAssociations';
  const properties: any[] = getBusinessObject(element)?.$descriptor?.properties ?? [];
  return properties.some((property: any) => property?.name === listName);
}

export function getInferredDataNeighbors(
  element: any,
  direction: 'inputs' | 'outputs',
): DataNeighbor[] {
  const businessObject = getBusinessObject(element);
  const listName = direction === 'inputs' ? 'dataInputAssociations' : 'dataOutputAssociations';
  const associations: any[] = businessObject?.get?.(listName) ?? businessObject?.[listName] ?? [];

  return associations
    .flatMap((association: any) => {
      // BPMN gives an input association many sources and an output association one target.
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
          outerScope: is(end, 'bpmn:Property') ? undefined : outerScopeOf(element, end),
          associationId: association?.id,
        }));
    });
}
