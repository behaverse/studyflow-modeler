import { BPMN } from '@core/constants';
import { idOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index';

/** A flow node with the sequence flows into and out of it and the boundary events on it, each in document order. */
export type GraphNode = {
  node: Element;
  incoming: Element[];
  outgoing: Element[];
  boundaries: Element[];
};

const list = (value: Value | undefined): Element[] => (Array.isArray(value) ? value.filter(isElement) : []);

/** Every container of flow elements: the processes and choreographies, and the sub-processes in them, outermost first. */
export function containers(model: StudyModel): Element[] {
  const found: Element[] = [];
  const visit = (container: Element): void => {
    found.push(container);
    for (const element of list(container.flowElements)) if (model.isA(element, BPMN.FlowElementsContainer)) visit(element);
  };
  for (const root of model.study.roots) if (model.isA(root, BPMN.FlowElementsContainer)) visit(root);
  return found;
}

/** A container's control flow: its sequence flows, and its flow nodes by element. The runners order a node's flows as the file does. */
export function graphOf(model: StudyModel, container: Element): { flows: Element[]; nodes: Map<Element, GraphNode> } {
  const elements = list(container.flowElements);
  const nodes = new Map<Element, GraphNode>();
  for (const node of elements) if (model.isA(node, BPMN.FlowNode)) nodes.set(node, { node, incoming: [], outgoing: [], boundaries: [] });
  const at = (ref: Value | undefined): GraphNode | undefined => {
    const target = model.get(idOf(ref) ?? undefined);
    return target ? nodes.get(target) : undefined;
  };
  const flows = elements.filter((element) => model.isA(element, BPMN.SequenceFlow));
  for (const flow of flows) {
    at(flow.sourceRef)?.outgoing.push(flow);
    at(flow.targetRef)?.incoming.push(flow);
  }
  for (const { node } of nodes.values()) if (model.isA(node, BPMN.BoundaryEvent)) at(node.attachedToRef)?.boundaries.push(node);
  return { flows, nodes };
}

/** How a message names an element: its name, else its id, quoted. */
export function quoted(element: Element): string {
  return `"${element.name || element.id}"`;
}
