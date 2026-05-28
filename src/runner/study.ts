import { parseStudyflow, type ParsedStudy } from '@/lib/core/parsers/studyflow';
import type { FlowNode, SequenceFlow } from '@/lib/core/flow';
import { findByFlowNode } from './nodes';
import type { Job } from './types';

export type StudyContext = {
  /** Deterministic random seed for gateways. */
  seed?: number;
  /** Variables exposed to `conditionExpression` evaluation. */
  variables?: Record<string, unknown>;
  /** BDM-aligned identity of the participant. Stamped onto every event via
   *  `agent.id`. Falls back to a per-device GUID on the Unity side when absent. */
  agentId?: string;
  /** Runner-session identifier. Stamped into `context.session`. */
  sessionId?: string;
  /** SHA-256 hex of the raw studyflow XML. Stamped into `context.studyflowHash`
   *  so downstream tools can pin every event to the exact source document. */
  studyflowHash?: string;
};

/** Walks a parsed studyflow, yielding `Job`s; owns the random source and variable bag. */
export class Study {
  businessObject: any;
  flowNodes: Map<string, FlowNode>;
  sequenceFlows: Map<string, SequenceFlow>;
  startId?: string;
  /** BDM `agent_id` for the run; undefined when running anonymously. */
  agentId?: string;
  /** Session identifier; undefined when running outside a managed session. */
  sessionId?: string;
  /** SHA-256 hex of the studyflow XML that produced this Study. */
  studyflowHash?: string;

  private random: () => number;
  private variables: Record<string, unknown>;

  static async parse(xml: string, schemas: Record<string, any>, context: StudyContext = {}): Promise<Study> {
    return new Study(await parseStudyflow(xml, schemas), context);
  }

  constructor(data: ParsedStudy, context: StudyContext = {}) {
    this.businessObject = data.businessObject;
    this.flowNodes = data.flowNodes;
    this.sequenceFlows = data.sequenceFlows;
    this.startId = data.startId;
    this.agentId = context.agentId;
    this.sessionId = context.sessionId;
    this.studyflowHash = context.studyflowHash;
    this.random = context.seed != null ? mulberry32(context.seed) : Math.random;
    this.variables = { ...(context.variables ?? {}) };
  }

  /** BDM `study_id`. Sourced from the BPMN root's `id` attribute. */
  get studyId(): string | undefined {
    const id = this.businessObject?.id;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  }

  /** Identifier for this specific studyflow document. Sourced from the BPMN
   *  root's `name` attribute — the same string the modeler navbar displays.
   *  Falls back to `studyId` when the document has no name. */
  get studyflowId(): string | undefined {
    const name = this.businessObject?.name;
    return typeof name === 'string' && name.length > 0 ? name : this.studyId;
  }

  setVariable(name: string, value: unknown): void {
    this.variables[name] = value;
  }

  async *traverse(): AsyncGenerator<Job, void, void> {
    if (!this.startId) throw new Error('No StartEvent found in diagram.');

    let currentId: string | undefined = this.startId;
    while (currentId) {
      const node = this.flowNodes.get(currentId);
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

  private isRandomGateway(node: FlowNode): boolean {
    const ext = node.extensionType;
    return ext === 'cognitive:RandomGateway' || ext === 'cognitive:StratifiedAllocationGateway';
  }

  private isExclusiveGateway(node: FlowNode): boolean {
    return node.type === 'bpmn:ExclusiveGateway' || node.type === 'bpmn:InclusiveGateway';
  }

  private firstOutgoingTarget(node: FlowNode): string | undefined {
    return this.sequenceFlows.get(node.outgoing[0])?.targetId;
  }

  private pickRandomBranch(node: FlowNode): string | undefined {
    const targets = node.outgoing
      .map((id) => this.sequenceFlows.get(id)?.targetId)
      .filter((t): t is string => !!t);
    if (targets.length === 0) return undefined;
    return targets[Math.floor(this.random() * targets.length)];
  }

  private pickConditionBranch(node: FlowNode): string | undefined {
    for (const flowId of node.outgoing) {
      const flow = this.sequenceFlows.get(flowId);
      if (flow?.conditionExpression && this.evalCondition(flow.conditionExpression)) {
        return flow.targetId;
      }
    }
    return undefined;
  }

  private pickDefaultBranch(node: FlowNode): string | undefined {
    const defaultFlowId = node.businessObject?.default?.id;
    if (defaultFlowId) {
      const flow = this.sequenceFlows.get(defaultFlowId);
      if (flow) return flow.targetId;
    }
    for (const flowId of node.outgoing) {
      const flow = this.sequenceFlows.get(flowId);
      if (flow && !flow.conditionExpression) return flow.targetId;
    }
    return this.firstOutgoingTarget(node);
  }

  private evalCondition(expression: string): boolean {
    const compiled = new Function('variables', `with (variables) { return (${expression}); }`);
    try { return Boolean(compiled(this.variables)); } catch { return false; }
  }
}

/** mulberry32 -- deterministic PRNG. */
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
