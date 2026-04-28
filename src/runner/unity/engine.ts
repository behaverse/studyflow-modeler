import { getProperty } from '@/v1/extensions/resolve';
import { getBehaverseTaskPayload } from './parser';
import type { RuntimeGraph, RuntimeNode, RuntimeStep } from './types';

export type EngineOptions = {
  /** Deterministic random seed for gateways . */
  seed?: number;
  /** Variables exposed to conditionExpression evaluation. */
  variables?: Record<string, unknown>;
};

export class StudyflowEngine {
  private graph: RuntimeGraph;
  private rand: () => number;
  private vars: Record<string, unknown>;

  constructor(graph: RuntimeGraph, options: EngineOptions = {}) {
    this.graph = graph;
    this.rand = options.seed != null ? random(options.seed) : Math.random;
    this.vars = { ...(options.variables ?? {}) };
  }

  setVariable(name: string, value: unknown): void {
    this.vars[name] = value;
  }

  async *run(): AsyncGenerator<RuntimeStep, void, void> {
    if (!this.graph.startId) {
      throw new Error('No StartEvent found in diagram.');
    }
    let currentId: string | undefined = this.graph.startId;

    while (currentId) {
      const node: RuntimeNode | undefined = this.graph.nodes.get(currentId);
      if (!node) {
        throw new Error(`Dangling node reference: ${currentId}`);
      }

      const step = this.toStep(node);
      if (step) yield step;
      if (step?.kind === 'end') return;

      currentId = this.advance(node);
    }
  }

  private toStep(node: RuntimeNode): RuntimeStep | null {
    switch (node.type) {
      case 'bpmn:StartEvent':
        return { kind: 'start', node };
      case 'bpmn:EndEvent':
        return { kind: 'end', node };
      case 'bpmn:Task':
      case 'bpmn:UserTask':
      case 'bpmn:ServiceTask':
      case 'bpmn:ScriptTask':
      case 'bpmn:ManualTask':
        return this.taskStep(node);
      case 'bpmn:ExclusiveGateway':
      case 'bpmn:InclusiveGateway':
      case 'bpmn:EventBasedGateway':
        return null;
      case 'bpmn:ParallelGateway':
        throw new Error(`ParallelGateway (${node.id}) is not supported in v1.`);
      default:
        return null;
    }
  }

  private taskStep(node: RuntimeNode): RuntimeStep | null {
    if (node.appliedType === 'behaverse:BehaverseTask') {
      const payload = getBehaverseTaskPayload(node);
      if (!payload) return null;
      return { kind: 'task', node, payload };
    }
    if (node.appliedType === 'studyflow:Instruction') {
      const content = (getProperty(node.businessObject, 'content') as string) || '';
      return { kind: 'instruction', node, content };
    }
    if (node.appliedType === 'studyflow:Questionnaire') {
      const instrument = getProperty(node.businessObject, 'instrument') as string | undefined;
      return { kind: 'questionnaire', node, instrument };
    }
    return null;
  }

  private advance(node: RuntimeNode): string | undefined {
    if (node.outgoing.length === 0) return undefined;

    if (this.isRandomGateway(node)) {
      return this.pickRandomBranch(node);
    }

    if (this.isExclusiveGateway(node)) {
      return this.pickConditionBranch(node) ?? this.pickDefaultBranch(node);
    }

    return this.firstOutgoingTarget(node);
  }

  private isRandomGateway(node: RuntimeNode): boolean {
    const t = node.appliedType;
    return t === 'studyflow:RandomGateway' || t === 'studyflow:StratifiedAllocationGateway';
  }

  private isExclusiveGateway(node: RuntimeNode): boolean {
    return node.type === 'bpmn:ExclusiveGateway' || node.type === 'bpmn:InclusiveGateway';
  }

  private firstOutgoingTarget(node: RuntimeNode): string | undefined {
    const edge = this.graph.edges.get(node.outgoing[0]);
    return edge?.targetId;
  }

  private pickRandomBranch(node: RuntimeNode): string | undefined {
    const targets = node.outgoing
      .map((id) => this.graph.edges.get(id)?.targetId)
      .filter((t): t is string => Boolean(t));
    if (targets.length === 0) return undefined;
    return targets[Math.floor(this.rand() * targets.length)];
  }

  private pickConditionBranch(node: RuntimeNode): string | undefined {
    for (const edgeId of node.outgoing) {
      const edge = this.graph.edges.get(edgeId);
      if (edge?.conditionExpression && this.evalCondition(edge.conditionExpression)) {
        return edge.targetId;
      }
    }
    return undefined;
  }

  private pickDefaultBranch(node: RuntimeNode): string | undefined {
    const defaultEdgeId = node.businessObject?.default?.id;
    if (defaultEdgeId) {
      const edge = this.graph.edges.get(defaultEdgeId);
      if (edge) return edge.targetId;
    }
    for (const edgeId of node.outgoing) {
      const edge = this.graph.edges.get(edgeId);
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
