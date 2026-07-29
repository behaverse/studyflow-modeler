import type { FlowNode } from '@/runner/models/flow';
import { getCatalog, type TypeCatalog } from '@/core/catalog';
import { findByFlowNode } from '@/runner/controllers/nodes/registry';
import { mulberry32, evaluateCondition } from '@/runner/models/rng';
import { ScopeChain } from '@/runner/models/scope';
import type { Job } from '@/runner/models/jobs';
import type { Studyflow } from '@/runner/models/studyflow';

export type SessionContext = {
  /** Deterministic random seed for gateways. */
  seed?: number;
  /** Initial variable bag, written into the scope chain before the walk. */
  variables?: Record<string, unknown>;
  /** BDM-aligned identity of the participant. Stamped onto every event via
   *  `agent.id`. Falls back to a per-device GUID on the Unity side when absent. */
  agentId?: string;
  /** Runner-session identifier. Stamped into `context.session`. */
  sessionId?: string;
  /** Catalog used to classify gateways. Defaults to the ambient loaded catalog;
   *  inject a specific one to traverse without the global (e.g. in tests). */
  catalog?: TypeCatalog;
  /** Sink for run-time defects that do not stop the walk (an undeclared name
   *  in a condition, a sub-process with no start event). */
  onDiagnostic?: (message: string) => void;
};

/** A single run of a {@link Studyflow} by a participant.
 *
 *  Owns the runtime state - the scope chain, the seeded PRNG, the participant
 *  identity - and walks the studyflow's graph via {@link traverse}. */
export class Session {
  studyflow: Studyflow;
  agentId?: string;
  sessionId?: string;

  private random: () => number;
  private scopes: ScopeChain;
  private catalog: TypeCatalog;
  private onDiagnostic?: (message: string) => void;
  /** Per-node entry counts, exposed to conditions as `state.visits.<id>` —
   *  the bound a drawn back-edge through a gateway is written against. */
  private visits: Record<string, number> = {};

  constructor(studyflow: Studyflow, context: SessionContext = {}) {
    this.studyflow = studyflow;
    this.agentId = context.agentId;
    this.sessionId = context.sessionId;
    this.random = context.seed != null ? mulberry32(context.seed) : Math.random;
    this.catalog = context.catalog ?? getCatalog();
    this.onDiagnostic = context.onDiagnostic;

    const root = studyflow.scopes.get(studyflow.rootScopeId);
    if (!root) throw new Error(`No root scope (${studyflow.rootScopeId}) in diagram.`);
    this.scopes = new ScopeChain(root, context.variables ?? {});
  }

  setVariable(name: string, value: unknown): void {
    this.scopes.write(name, value);
  }

  /** Every visible binding, inner scope shadowing outer. */
  getVariables(): Record<string, unknown> {
    return this.scopes.bindings();
  }

  /** Names written at run time that no scope declared. Empty is the goal:
   *  it means every value the run carried was declared in the file. */
  getUndeclaredVariables(): string[] {
    return this.scopes.undeclared();
  }

  async *traverse(): AsyncGenerator<Job, void, void> {
    if (!this.studyflow.startId) throw new Error('No StartEvent found in diagram.');

    let currentId: string | undefined = this.studyflow.startId;
    /** Sub-process nodes to resume from, innermost last. Parallel to the
     *  scope chain's frames: one entry per open sub-process instance. */
    const returns: string[] = [];

    while (currentId) {
      const node = this.studyflow.flowNodes.get(currentId);
      if (!node) throw new Error(`Dangling node reference: ${currentId}`);

      this.visits[node.id] = (this.visits[node.id] ?? 0) + 1;

      // Entering a sub-process opens a scope instance and descends into its
      // own flow; the token resumes at the sub-process node when it ends.
      if (node.type === 'bpmn:SubProcess') {
        const scope = this.studyflow.scopes.get(node.id);
        if (scope?.startId) {
          this.scopes.push(scope);
          returns.push(node.id);
          currentId = scope.startId;
          continue;
        }
        this.diagnose(`sub-process "${node.id}" has no start event; treated as a pass-through`);
        currentId = this.advance(node);
        continue;
      }

      // An end event inside a sub-process closes that scope instance rather
      // than the run: its values go out of scope and the token resumes outside.
      if (node.type === 'bpmn:EndEvent' && returns.length > 0) {
        this.scopes.pop();
        const resumeAt = this.studyflow.flowNodes.get(returns.pop()!);
        currentId = resumeAt ? this.advance(resumeAt) : undefined;
        continue;
      }

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

    // Model-driven routing needs an LLM call, which the browser runner cannot
    // make mid-traversal. Refuse it rather than fall through to the condition
    // arm below, which would silently take the default branch.
    if (this.branchingMode(node) === 'model') {
      throw new Error(`Model-driven routing (${node.id}) is not supported yet.`);
    }
    if (this.branchingMode(node) === 'random') return this.pickRandomBranch(node);
    if (this.isExclusiveGateway(node)) return this.pickConditionBranch(node) ?? this.pickDefaultBranch(node);
    return this.firstOutgoingTarget(node);
  }

  /** Schema-driven: gateway types declare how they pick a branch via `meta: {branching}`. */
  private branchingMode(node: FlowNode): string | undefined {
    if (!node.extensionType) return undefined;
    const mode = this.catalog.getType(node.extensionType)?.meta?.branching;
    return typeof mode === 'string' ? mode : undefined;
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
      if (flow?.conditionExpression && this.evalCondition(flow.conditionExpression, flowId)) {
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

  /** Bindings a condition sees: the visible declarations, plus the engine's
   *  own `state` (visit counts), which the diagram does not declare. */
  private conditionBindings(): Record<string, unknown> {
    return { ...this.scopes.bindings(), state: { visits: { ...this.visits } } };
  }

  private evalCondition(expression: string, flowId: string): boolean {
    const { value, error } = evaluateCondition(expression, this.conditionBindings());
    if (error) this.diagnose(`condition on "${flowId}" did not evaluate (${error}); branch not taken`);
    return value;
  }

  private diagnose(message: string): void {
    this.onDiagnostic?.(message);
    if (!this.onDiagnostic) console.warn(`[studyflow] ${message}`);
  }
}
