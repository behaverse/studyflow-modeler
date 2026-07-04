import type { FlowNode } from '@/runner/models/flow';
import { getCatalog, type TypeCatalog } from '@/core/catalog';
import { findByFlowNode } from '@/runner/controllers/nodes';
import { mulberry32, evaluateCondition } from '@/runner/models/rng';
import type { Job } from '@/runner/models/jobs';
import type { Studyflow } from '@/runner/models/studyflow';

export type SessionContext = {
  /** Deterministic random seed for gateways. */
  seed?: number;
  /** Initial variable bag, exposed to `conditionExpression` evaluation. */
  variables?: Record<string, unknown>;
  /** BDM-aligned identity of the participant. Stamped onto every event via
   *  `agent.id`. Falls back to a per-device GUID on the Unity side when absent. */
  agentId?: string;
  /** Runner-session identifier. Stamped into `context.session`. */
  sessionId?: string;
  /** Catalog used to classify gateways. Defaults to the ambient loaded catalog;
   *  inject a specific one to traverse without the global (e.g. in tests). */
  catalog?: TypeCatalog;
};

/** A single run of a {@link Studyflow} by a participant.
 *
 *  Owns the runtime state - the variable bag, the seeded PRNG, the participant
 *  identity - and walks the studyflow's graph via {@link traverse}. */
export class Session {
  studyflow: Studyflow;
  agentId?: string;
  sessionId?: string;

  private random: () => number;
  private variables: Record<string, unknown>;
  private catalog: TypeCatalog;

  constructor(studyflow: Studyflow, context: SessionContext = {}) {
    this.studyflow = studyflow;
    this.agentId = context.agentId;
    this.sessionId = context.sessionId;
    this.random = context.seed != null ? mulberry32(context.seed) : Math.random;
    this.variables = { ...(context.variables ?? {}) };
    this.catalog = context.catalog ?? getCatalog();
  }

  setVariable(name: string, value: unknown): void {
    this.variables[name] = value;
  }

  getVariables(): Record<string, unknown> {
    return { ...this.variables };
  }

  async *traverse(): AsyncGenerator<Job, void, void> {
    if (!this.studyflow.startId) throw new Error('No StartEvent found in diagram.');

    let currentId: string | undefined = this.studyflow.startId;
    while (currentId) {
      const node = this.studyflow.flowNodes.get(currentId);
      if (!node) throw new Error(`Dangling node reference: ${currentId}`);

      const job = this.toJob(node);
      if (job) yield job;
      if (job?.type === 'end') return;

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

  /** Schema-driven: gateway types declare `meta: {branching: random}`. */
  private isRandomGateway(node: FlowNode): boolean {
    if (!node.extensionType) return false;
    return this.catalog.getType(node.extensionType)?.meta?.branching === 'random';
  }

  private isExclusiveGateway(node: FlowNode): boolean {
    return node.type === 'bpmn:ExclusiveGateway' || node.type === 'bpmn:InclusiveGateway';
  }

  private firstOutgoingTarget(node: FlowNode): string | undefined {
    return this.studyflow.sequenceFlows.get(node.outgoing[0])?.targetId;
  }

  private pickRandomBranch(node: FlowNode): string | undefined {
    const targets = node.outgoing
      .map((id) => this.studyflow.sequenceFlows.get(id)?.targetId)
      .filter((t): t is string => !!t);
    if (targets.length === 0) return undefined;
    return targets[Math.floor(this.random() * targets.length)];
  }

  private pickConditionBranch(node: FlowNode): string | undefined {
    for (const flowId of node.outgoing) {
      const flow = this.studyflow.sequenceFlows.get(flowId);
      if (flow?.conditionExpression && this.evalCondition(flow.conditionExpression)) {
        return flow.targetId;
      }
    }
    return undefined;
  }

  private pickDefaultBranch(node: FlowNode): string | undefined {
    const defaultFlowId = node.businessObject?.default?.id;
    if (defaultFlowId) {
      const flow = this.studyflow.sequenceFlows.get(defaultFlowId);
      if (flow) return flow.targetId;
    }
    for (const flowId of node.outgoing) {
      const flow = this.studyflow.sequenceFlows.get(flowId);
      if (flow && !flow.conditionExpression) return flow.targetId;
    }
    return this.firstOutgoingTarget(node);
  }

  private evalCondition(expression: string): boolean {
    return evaluateCondition(expression, this.variables);
  }
}
