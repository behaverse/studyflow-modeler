import { parseStudyflow } from '@/lib/core/parsers/studyflow';
import type { FlowNode, SequenceFlow } from '@/lib/core/flow';
import { findByFlowNode } from './nodes';
import type { Job } from './types';

export type StudyOptions = {
  // Deterministic random seed for gateways.
  seed?: number;
  // Variables exposed to `conditionExpression` evaluation.
  variables?: Record<string, unknown>;
};

type StudyData = {
  businessObject: any;
  nodes: Map<string, FlowNode>;
  edges: Map<string, SequenceFlow>;
  startId?: string;
};

// A parsed studyflow plus the runtime state needed to walk it: random source,
// variable bag, and the `traverse()` generator that yields Jobs to the runner.
export class Study {
  businessObject: any;
  nodes: Map<string, FlowNode>;
  edges: Map<string, SequenceFlow>;
  startId?: string;

  private rand: () => number;
  private vars: Record<string, unknown>;

  static async parse(xml: string, schemas: Record<string, any>, options: StudyOptions = {}): Promise<Study> {
    return new Study(await parseStudyflow(xml, schemas), options);
  }

  constructor(data: StudyData, options: StudyOptions = {}) {
    this.businessObject = data.businessObject;
    this.nodes = data.nodes;
    this.edges = data.edges;
    this.startId = data.startId;
    this.rand = options.seed != null ? mulberry32(options.seed) : Math.random;
    this.vars = { ...(options.variables ?? {}) };
  }

  setVariable(name: string, value: unknown): void {
    this.vars[name] = value;
  }

  async *traverse(): AsyncGenerator<Job, void, void> {
    if (!this.startId) throw new Error('No StartEvent found in diagram.');

    let currentId: string | undefined = this.startId;
    while (currentId) {
      const node = this.nodes.get(currentId);
      if (!node) throw new Error(`Dangling node reference: ${currentId}`);

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
    return (findByFlowNode(node)?.toJob(node) as Job | null | undefined) ?? null;
  }

  private advance(node: FlowNode): string | undefined {
    if (node.outgoing.length === 0) return undefined;
    if (this.isRandomGateway(node)) return this.pickRandomBranch(node);
    if (this.isExclusiveGateway(node)) return this.pickConditionBranch(node) ?? this.pickDefaultBranch(node);
    return this.firstOutgoingTarget(node);
  }

  private isRandomGateway(node: FlowNode): boolean {
    const t = node.extensionType;
    return t === 'cognitive:RandomGateway' || t === 'cognitive:StratifiedAllocationGateway';
  }

  private isExclusiveGateway(node: FlowNode): boolean {
    return node.type === 'bpmn:ExclusiveGateway' || node.type === 'bpmn:InclusiveGateway';
  }

  private firstOutgoingTarget(node: FlowNode): string | undefined {
    return this.edges.get(node.outgoing[0])?.targetId;
  }

  private pickRandomBranch(node: FlowNode): string | undefined {
    const targets = node.outgoing
      .map((id) => this.edges.get(id)?.targetId)
      .filter((t): t is string => !!t);
    if (targets.length === 0) return undefined;
    return targets[Math.floor(this.rand() * targets.length)];
  }

  private pickConditionBranch(node: FlowNode): string | undefined {
    for (const edgeId of node.outgoing) {
      const edge = this.edges.get(edgeId);
      if (edge?.conditionExpression && this.evalCondition(edge.conditionExpression)) {
        return edge.targetId;
      }
    }
    return undefined;
  }

  private pickDefaultBranch(node: FlowNode): string | undefined {
    const defaultEdgeId = node.businessObject?.default?.id;
    if (defaultEdgeId) {
      const edge = this.edges.get(defaultEdgeId);
      if (edge) return edge.targetId;
    }
    for (const edgeId of node.outgoing) {
      const edge = this.edges.get(edgeId);
      if (edge && !edge.conditionExpression) return edge.targetId;
    }
    return this.firstOutgoingTarget(node);
  }

  private evalCondition(expression: string): boolean {
    const fn = new Function('vars', `with (vars) { return (${expression}); }`);
    try { return Boolean(fn(this.vars)); } catch { return false; }
  }
}

// Deterministic PRNG (mulberry32).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
