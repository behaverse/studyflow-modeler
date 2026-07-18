import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil';
import { getCatalog, isBpmnSubtypeOf } from '@/core/catalog';
import { getAttribute, StudyflowElement } from '@/core/extensions';

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

export type DataNeighbor = {
  /** Display name of the wired data element. */
  name: string;
  /** `parameter` (inputs) / the native `transformation` expression (outputs)
   *  declared on the association; unset means the whole value flows, bound
   *  by the element's name. */
  binding?: string;
};

/** An activity's inputs and outputs are not listed anywhere - they are
 *  detected from the data associations drawn on the canvas. */
export function getInferredDataNeighbors(
  element: any,
  direction: 'inputs' | 'outputs',
): DataNeighbor[] {
  const edges = (direction === 'inputs' ? element?.incoming : element?.outgoing) ?? [];
  const otherEnd = direction === 'inputs' ? 'source' : 'target';
  const bindingAttr = direction === 'inputs' ? 'parameter' : 'transformation';
  return edges
    .filter((edge: any) => isDataElement(edge?.[otherEnd]))
    .map((edge: any) => ({
      name: nameOf(edge[otherEnd]),
      binding: getAttribute(getBusinessObject(edge), bindingAttr) || undefined,
    }))
    .filter((n: DataNeighbor): n is DataNeighbor => !!n.name);
}
