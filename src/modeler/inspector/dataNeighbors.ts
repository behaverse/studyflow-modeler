import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil';
import { getExtensionType } from '@/lib/core/extensions';

const DATA_BPMN_TYPES = [
  'bpmn:DataObject',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:DataInput',
  'bpmn:DataOutput',
];

const DATA_STUDYFLOW_TYPES = new Set([
  'studyflow:Dataset',
  'studyflow:Schema',
  'studyflow:DataStorage',
  'studyflow:DataObjectReference',
  'studyflow:Array',
  'studyflow:Snapshot',
]);

function isDataElement(element: any): boolean {
  if (!element) return false;
  if (DATA_BPMN_TYPES.some((t) => is(element, t))) return true;
  const ext = getExtensionType(element);
  return ext ? DATA_STUDYFLOW_TYPES.has(ext) : false;
}

function nameOf(element: any): string | undefined {
  const bo = getBusinessObject(element);
  return bo?.name || bo?.id || element?.id;
}

export function getInferredDataNeighbors(
  element: any,
  direction: 'inputs' | 'outputs',
): string[] {
  const edges = (direction === 'inputs' ? element?.incoming : element?.outgoing) || [];
  const otherEnd = direction === 'inputs' ? 'source' : 'target';
  return edges
    .map((edge: any) => edge?.[otherEnd])
    .filter(isDataElement)
    .map(nameOf)
    .filter((n: string | undefined): n is string => Boolean(n));
}
