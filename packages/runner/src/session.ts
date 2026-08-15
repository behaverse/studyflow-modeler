import type { FlowNode } from '@runner/flow';
import { getCatalog, type TypeCatalog } from '@core/notation';
import { findByFlowNode } from '@runner/nodes/registry';
import { mulberry32, evaluateCondition } from '@runner/branching';
import { ScopeChain } from '@runner/scope';
import type { Job } from '@runner/jobs';
import type { Studyflow } from '@runner/studyflow';
import { BPMN } from '@core/constants';

const ROUTING_TYPES: ReadonlySet<string> = new Set<string>([
  BPMN.ExclusiveGateway,
  BPMN.InclusiveGateway,
  BPMN.ParallelGateway,
  BPMN.EventBasedGateway,
  BPMN.ComplexGateway,
  BPMN.SequenceFlow,
]);

export type SessionContext = {
  seed?: number;
  variables?: Record<string, unknown>;
  agentId?: string;
  sessionId?: string;
  catalog?: TypeCatalog;
  onDiagnostic?: (message: string) => void;
};

export class Session {
  studyflow: Studyflow;
  agentId?: string;
  sessionId?: string;

  private random: () => number;
  private scopes: ScopeChain;
  private catalog: TypeCatalog;
  private onDiagnostic?: (message: string) => void;
  private trace: string[] = [];

  constructor(studyflow: Studyflow, context: SessionContext = {}) {
    this.studyflow = studyflow;
    this.agentId = context.agentId;
    this.sessionId = context.sessionId;
    this.random = context.seed != null ? mulberry32(context.seed) : Math.random;
    this.catalog = context.catalog ?? getCatalog();
    this.onDiagnostic = context.onDiagnostic;

    const root = studyflow.scopes.get(studyflow.rootScopeId);
    if (!root) throw new Error(`This studyflow has no study to run (no scope '${studyflow.rootScopeId}').`);
    this.scopes = new ScopeChain(root, context.variables ?? {});
  }

  setVariable(name: string, value: unknown): void {
    this.scopes.write(name, value);
  }

  getVariables(): Record<string, unknown> {
    return this.scopes.bindings();
  }

  getUndeclaredVariables(): string[] {
    return this.scopes.undeclared();
  }

  async *traverse(): AsyncGenerator<Job, void, void> {
    if (!this.studyflow.startId) {
      throw new Error('This studyflow has no start event, so there is no first step. Add one in the modeler.');
    }

    let currentId: string | undefined = this.studyflow.startId;
    const returns: string[] = [];

    while (currentId) {
      const node = this.studyflow.flowNodes.get(currentId);
      if (!node) {
        throw new Error(`A sequence flow leads to '${currentId}', which is not in this studyflow. Reconnect it in the modeler.`);
      }

      this.trace.push(node.id);

      if (node.type === 'bpmn:SubProcess') {
        const scope = this.studyflow.scopes.get(node.id);
        if (scope?.startId) {
          this.scopes.push(scope);
          returns.push(node.id);
          currentId = scope.startId;
          continue;
        }
        this.diagnose(`sub-process '${node.id}' has no start event, so nothing inside it runs; stepping past it`);
        currentId = this.advance(node);
        continue;
      }

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
      throw new Error(
        `The browser runner shows one step at a time, so it cannot run the parallel branches at '${node.id}'. `
        + 'Put the steps in sequence, or split them with an ExclusiveGateway.',
      );
    }

    const definition = findByFlowNode(node);
    if (!definition) {
      if (!ROUTING_TYPES.has(node.type)) {
        this.diagnose(
          `'${node.id}' (${node.extensionType ?? node.type}) is not executable in the browser runner; step skipped`,
        );
      }
      return null;
    }

    const job = (definition.toJob(node) as Job | null | undefined) ?? null;
    if (!job) {
      this.diagnose(`'${node.id}' (${definition.type}) has nothing to run; step skipped`);
    }
    return job;
  }

  private advance(node: FlowNode): string | undefined {
    if (node.outgoing.length === 0) return undefined;

    if (this.branchingMode(node) === 'model') {
      throw new Error(
        `Model-driven routing is not implemented, so '${node.id}' cannot pick a branch. `
        + 'Use a gateway with a condition on each outgoing flow, or a RandomGateway.',
      );
    }
    if (this.branchingMode(node) === 'random') return this.pickRandomBranch(node);
    if (this.isExclusiveGateway(node)) return this.pickConditionBranch(node) ?? this.pickDefaultBranch(node);
    return this.firstOutgoingTarget(node);
  }

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
      if (flow?.conditionExpression
        && this.evalCondition(flow.conditionExpression, flowId, flow.conditionLanguage)) {
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

  private conditionBindings(): Record<string, unknown> {
    const entries = [...this.trace];
    const trace = Object.assign(entries, {
      count: (value: unknown): number => entries.filter((entry) => entry === value).length,
    });
    return { ...this.scopes.bindings(), state: { trace } };
  }

  private evalCondition(expression: string, flowId: string, language?: string): boolean {
    const { value, error } = evaluateCondition(expression, this.conditionBindings(), language);
    if (error) this.diagnose(`the condition on '${flowId}' could not be evaluated (${error}), so that branch was not taken`);
    return value;
  }

  private diagnose(message: string): void {
    this.onDiagnostic?.(message);
    if (!this.onDiagnostic) console.warn(`[studyflow] ${message}`);
  }
}
