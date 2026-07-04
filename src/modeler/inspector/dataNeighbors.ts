import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil';
import { getCatalog, isBpmnSubtypeOf } from '@/lib/core/catalog';
import { StudyflowElement } from '@/lib/core/extensions';

/** BPMN 2.0 data element kinds (frozen spec). Schema types count as data
 *  elements when their catalog `bpmnType` resolves into one of these. */
const DATA_BPMN_TYPES = [
  'bpmn:DataObject',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:DataInput',
  'bpmn:DataOutput',
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

export function getInferredDataNeighbors(
  element: any,
  direction: 'inputs' | 'outputs',
): string[] {
  const edges = (direction === 'inputs' ? element?.incoming : element?.outgoing) ?? [];
  const otherEnd = direction === 'inputs' ? 'source' : 'target';
  return edges
    .map((edge: any) => edge?.[otherEnd])
    .filter(isDataElement)
    .map(nameOf)
    .filter((n: string | undefined): n is string => !!n);
}
