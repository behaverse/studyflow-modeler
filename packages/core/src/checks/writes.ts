import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { containers, graphOf, quoted, type GraphNode } from '@core/checks/graph';
import { idOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index';

const list = (value: Value | undefined): Element[] => (Array.isArray(value) ? value.filter(isElement) : []);

/** The data element an edge writes: the data object or store a reference names, else the element itself. */
function dataOf(model: StudyModel, element: Element): Element {
  const named = model.get(idOf(element.dataObjectRef ?? element.dataStoreRef) ?? undefined);
  return named ?? element;
}

/** What `node` writes along its data output associations, and, for a sub-process, what the steps inside it write. */
function writesOf(model: StudyModel, node: Element): Element[] {
  const written = list(node.dataOutputAssociations)
    .map((edge) => model.get(idOf(edge.targetRef) ?? undefined))
    .filter((data): data is Element => !!data)
    .map((data) => dataOf(model, data));
  for (const inner of list(node.flowElements)) if (model.isA(inner, BPMN.FlowNode)) written.push(...writesOf(model, inner));
  return written;
}

/** The nodes the flow `from` leads to, and each node they lead to in turn, along flows and boundary events. */
function reach(model: StudyModel, nodes: Map<Element, GraphNode>, from: Element): Set<GraphNode> {
  const at = (ref: Value | undefined): GraphNode | undefined => {
    const element = model.get(idOf(ref) ?? undefined);
    return element ? nodes.get(element) : undefined;
  };
  const seen = new Set<GraphNode>();
  const queue = [at(from.targetRef)];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    queue.push(...current.outgoing.map((flow) => at(flow.targetRef)), ...current.boundaries.map((boundary) => nodes.get(boundary)));
  }
  return seen;
}

/**
 * Two steps that can run at once and write the same property or data element: the walk takes a step's outputs when it
 * finishes, so the one that finishes last sets the value, and which that is depends on how long each takes
 * (packages/runtime-local/WALK.md, "State"). Paths run at once from a split that takes several of its flows (a parallel
 * or inclusive gateway, or an activity or event with several flows out), so the steps that only one of its flows
 * reaches run beside the steps that only another reaches; a step every flow reaches comes after the paths meet. This
 * reads the drawing as blocks, so a step the paths meet at inside a loop is not compared; and pools, which also run at
 * once, ordered only by their messages, are not compared at all.
 */
export function checkWrites(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  const reported = new Set<string>();
  for (const container of containers(model)) {
    const { nodes } = graphOf(model, container);
    const writes = new Map([...nodes.keys()].map((node) => [node, new Set(writesOf(model, node))]));
    for (const { node: split, outgoing } of nodes.values()) {
      const splits = model.isA(split, BPMN.ParallelGateway) || model.isA(split, BPMN.InclusiveGateway) || !model.isA(split, BPMN.Gateway);
      if (!splits || outgoing.length < 2) continue;
      const reached = outgoing.map((flow) => reach(model, nodes, flow));
      const own = reached.map((set, i) => [...set].filter((node) => reached.every((other, j) => j === i || !other.has(node))));
      for (let i = 0; i < own.length; i += 1) {
        for (let j = i + 1; j < own.length; j += 1) {
          for (const a of own[i]) {
            for (const b of own[j]) {
              for (const data of writes.get(a.node)!) {
                if (!writes.get(b.node)!.has(data)) continue;
                const key = [data.id, ...[a.node.id, b.node.id].sort()].join(' ');
                if (reported.has(key)) continue;
                reported.add(key);
                issues.push({
                  severity: 'warning',
                  elementId: b.node.id,
                  message: `${quoted(a.node)} and ${quoted(b.node)} both write ${quoted(data)} on paths that run at once from ${quoted(split)}, so the one that finishes last sets it`,
                });
              }
            }
          }
        }
      }
    }
  }
  return issues;
}
