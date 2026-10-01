import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { quoted } from '@core/checks/graph';
import { idOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index';

const DATA = 'bpmn:ItemAwareElement';

const refs = (value: Value | undefined): Value[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

const list = (value: Value | undefined): Element[] => (Array.isArray(value) ? value.filter(isElement) : []);

/**
 * Well-formedness condition 2: edges respect type and scope. A sequence flow runs between two flow nodes of the
 * process or sub-process that holds it; a data association connects a data element to the flow node it belongs to;
 * and a node reads or writes a property only where it or a scope around it declares it.
 */
export function checkEndpoints(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  const report = (element: Element, message: string): void => { issues.push({ severity: 'error', elementId: model.ownerOf(element), message }); };

  for (const flow of model.all()) {
    if (!model.isA(flow, BPMN.SequenceFlow)) continue;
    const container = model.parentOf(flow);
    for (const [end, ref] of [['source', flow.sourceRef], ['target', flow.targetRef]] as const) {
      const node = model.get(idOf(ref) ?? undefined);
      if (!node) report(flow, `sequence flow ${quoted(flow)} has no ${end}`);
      else if (!model.isA(node, BPMN.FlowNode)) report(flow, `sequence flow ${quoted(flow)} has ${quoted(node)} as its ${end}, which is no event, activity or gateway: data is drawn with a data association`);
      else if (model.parentOf(node) !== container) report(flow, `sequence flow ${quoted(flow)} leaves its ${container ? quoted(container) : 'container'} for ${quoted(node)}: a sequence flow stays inside one process or sub-process, and a message flow goes between pools`);
    }
  }

  for (const node of model.all()) {
    if (!model.isA(node, BPMN.FlowNode)) continue;
    const scopes = new Set<Element>();
    for (let at: Element | undefined = node; at; at = model.parentOf(at)) scopes.add(at);
    const edges = [
      ...list(node.dataInputAssociations).flatMap((edge) => refs(edge.sourceRef).map((ref) => ({ edge, ref, verb: 'reads' }))),
      ...list(node.dataOutputAssociations).map((edge) => ({ edge, ref: edge.targetRef, verb: 'writes' })),
    ];
    for (const { edge, ref, verb } of edges) {
      const data = model.get(idOf(ref) ?? undefined);
      if (!data) continue;  // an edge with no data element is the reader's to report
      if (!model.isA(data, DATA)) {
        report(edge, `${quoted(node)} ${verb} ${quoted(data)} along a data association, but it is no data element: an order between steps is a sequence flow`);
      } else if (model.isA(data, BPMN.Property) && !scopes.has(model.parentOf(data)!)) {
        const owner = model.parentOf(data);
        report(edge, `${quoted(node)} ${verb} property ${quoted(data)}, which ${owner ? quoted(owner) : 'nothing'} declares, outside it: a node reads and writes the properties of the scopes around it`);
      }
    }
  }
  return issues;
}
