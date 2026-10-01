import { getCatalog, isBpmnSubtypeOf } from '@core/notation';
import { idOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index';

const DATA_BPMN_TYPES = [
  'bpmn:DataObject',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:DataInput',
  'bpmn:DataOutput',
  'bpmn:Property',
];

function isDataElement(model: StudyModel, element: Element): boolean {
  if (DATA_BPMN_TYPES.some((t) => model.isA(element, t))) return true;
  const bpmnType = getCatalog().bpmnTypeOf(model.extensionType(element));
  return !!bpmnType && DATA_BPMN_TYPES.some((t) => isBpmnSubtypeOf(bpmnType, t));
}

const nameOf = (element: Element): string | undefined => (typeof element.name === 'string' && element.name) || element.id;

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

function kindOf(model: StudyModel, element: Element): string {
  for (const [type, label] of KIND_LABELS) if (model.isA(element, type)) return label;
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

function containerOf(model: StudyModel, element: Element): Element | undefined {
  let node = model.parentOf(element);
  while (node && !model.isA(node, 'bpmn:Process') && !model.isA(node, 'bpmn:SubProcess')) node = model.parentOf(node);
  return node;
}

function outerScopeOf(model: StudyModel, element: Element, dataElement: Element): string | undefined {
  const owner = containerOf(model, dataElement);
  if (!owner || owner === containerOf(model, element)) return undefined;
  return nameOf(owner);
}

export function supportsDataAssociations(model: StudyModel, element: Element, direction: 'inputs' | 'outputs'): boolean {
  return !!model.property(element, direction === 'inputs' ? 'dataInputAssociations' : 'dataOutputAssociations');
}

const listIn = (value: Value | undefined): Value[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

export function getInferredDataNeighbors(model: StudyModel, element: Element, direction: 'inputs' | 'outputs'): DataNeighbor[] {
  const associations = listIn(element[direction === 'inputs' ? 'dataInputAssociations' : 'dataOutputAssociations']).filter(isElement);

  return associations.flatMap((association) => {
    // BPMN gives an input association many sources and an output association one target.
    const ends = (direction === 'inputs' ? listIn(association.sourceRef) : listIn(association.targetRef))
      .map((ref) => model.get(idOf(ref) ?? undefined))
      .filter((end): end is Element => !!end);
    const raw = isElement(association.transformation) ? association.transformation.body : association.transformation;
    const binding = (typeof raw === 'string' ? raw : undefined) || undefined;

    return ends
      .filter((end) => isDataElement(model, end) && !!nameOf(end))
      .map((end): DataNeighbor => ({
        name: nameOf(end)!,
        binding,
        declared: model.isA(end, 'bpmn:Property'),
        kind: kindOf(model, end),
        outerScope: model.isA(end, 'bpmn:Property') ? undefined : outerScopeOf(model, element, end),
        associationId: association.id,
      }));
  });
}
