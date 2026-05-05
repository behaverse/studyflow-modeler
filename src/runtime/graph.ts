import { findByFlowNode } from './nodes';
import type { Process, FlowNode, Job } from './types';

export type GraphOptions = {
  /** Deterministic random seed for gateways. */
  seed?: number;
  /** Variables exposed to conditionExpression evaluation. */
  variables?: Record<string, unknown>;
};

export class Graph {
  private process: Process;
  private rand: () => number;
  private vars: Record<string, unknown>;

  constructor(process: Process, options: GraphOptions = {}) {
    this.process = process;
    this.rand = options.seed != null ? random(options.seed) : Math.random;
    this.vars = { ...(options.variables ?? {}) };
  }

  setVariable(name: string, value: unknown): void {
    this.vars[name] = value;
  }

  async *traverse(): AsyncGenerator<Job, void, void> {
    if (!this.process.startId) {
      throw new Error('No StartEvent found in diagram.');
    }
    let currentId: string | undefined = this.process.startId;

    while (currentId) {
      const node: FlowNode | undefined = this.process.nodes.get(currentId);
      if (!node) {
        throw new Error(`Dangling node reference: ${currentId}`);
      }

      const job = this.toJob(node);
      if (job) yield job;
      if (job?.kind === 'end') return;

      currentId = this.advance(node);
    }
  }

  private toJob(node: FlowNode): Job | null {
    if (node.type === 'bpmn:ParallelGateway') {
      throw new Error(`ParallelGateway (${node.id}) is not supported yet.`);
    }
    const def = findByFlowNode(node);
    return (def?.toJob(node) as Job | null | undefined) ?? null;
  }

  private advance(node: FlowNode): string | undefined {
    if (node.outgoing.length === 0) return undefined;

    if (this.isRandomGateway(node)) {
      return this.pickRandomBranch(node);
    }

    if (this.isExclusiveGateway(node)) {
      return this.pickConditionBranch(node) ?? this.pickDefaultBranch(node);
    }

    return this.firstOutgoingTarget(node);
  }

  private isRandomGateway(node: FlowNode): boolean {
    const t = node.extensionType;
    return t === 'studyflow:RandomGateway' || t === 'studyflow:StratifiedAllocationGateway';
  }

  private isExclusiveGateway(node: FlowNode): boolean {
    return node.type === 'bpmn:ExclusiveGateway' || node.type === 'bpmn:InclusiveGateway';
  }

  private firstOutgoingTarget(node: FlowNode): string | undefined {
    const edge = this.process.edges.get(node.outgoing[0]);
    return edge?.targetId;
  }

  private pickRandomBranch(node: FlowNode): string | undefined {
    const targets = node.outgoing
      .map((id) => this.process.edges.get(id)?.targetId)
      .filter((t): t is string => Boolean(t));
    if (targets.length === 0) return undefined;
    return targets[Math.floor(this.rand() * targets.length)];
  }

  private pickConditionBranch(node: FlowNode): string | undefined {
    for (const edgeId of node.outgoing) {
      const edge = this.process.edges.get(edgeId);
      if (edge?.conditionExpression && this.evalCondition(edge.conditionExpression)) {
        return edge.targetId;
      }
    }
    return undefined;
  }

  private pickDefaultBranch(node: FlowNode): string | undefined {
    const defaultEdgeId = node.businessObject?.default?.id;
    if (defaultEdgeId) {
      const edge = this.process.edges.get(defaultEdgeId);
      if (edge) return edge.targetId;
    }
    for (const edgeId of node.outgoing) {
      const edge = this.process.edges.get(edgeId);
      if (edge && !edge.conditionExpression) return edge.targetId;
    }
    return this.firstOutgoingTarget(node);
  }

  private evalCondition(expression: string): boolean {
    const fn = new Function('vars', `with (vars) { return (${expression}); }`);
    try {
      return Boolean(fn(this.vars));
    } catch {
      return false;
    }
  }
}

// deterministic random number generator (mulberry32)
function random(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
