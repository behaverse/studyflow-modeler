import { BPMN } from '@core/constants';
import type { ModdleElement } from '@core/element/moddle';

/** A flow node with the sequence flows into and out of it and the boundary events on it, each in document order. */
export type GraphNode = {
  node: ModdleElement;
  incoming: ModdleElement[];
  outgoing: ModdleElement[];
  boundaries: ModdleElement[];
};

export const isA = (element: any, type: string): boolean => !!element?.$instanceOf?.(type);

/** Every container of flow elements: the processes and choreographies, and the sub-processes in them, outermost first. */
export function containers(definitions: ModdleElement): ModdleElement[] {
  const found: ModdleElement[] = [];
  const visit = (container: ModdleElement): void => {
    found.push(container);
    for (const element of container.flowElements ?? []) if (isA(element, BPMN.FlowElementsContainer)) visit(element);
  };
  for (const root of definitions.rootElements ?? []) if (isA(root, BPMN.FlowElementsContainer)) visit(root);
  return found;
}

/** A container's control flow: its sequence flows, and its flow nodes by element. The runners order a node's flows as the file does. */
export function graphOf(container: ModdleElement): { flows: ModdleElement[]; nodes: Map<ModdleElement, GraphNode> } {
  const elements: ModdleElement[] = container.flowElements ?? [];
  const nodes = new Map<ModdleElement, GraphNode>();
  for (const node of elements) if (isA(node, BPMN.FlowNode)) nodes.set(node, { node, incoming: [], outgoing: [], boundaries: [] });
  const flows = elements.filter((element) => isA(element, BPMN.SequenceFlow));
  for (const flow of flows) {
    nodes.get(flow.sourceRef)?.outgoing.push(flow);
    nodes.get(flow.targetRef)?.incoming.push(flow);
  }
  for (const { node } of nodes.values()) if (isA(node, BPMN.BoundaryEvent)) nodes.get(node.attachedToRef)?.boundaries.push(node);
  return { flows, nodes };
}

/** How a message names an element: its name, else its id, quoted. */
export function quoted(element: ModdleElement): string {
  return `"${element.name || element.id}"`;
}
