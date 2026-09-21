import type { FlowNode, SequenceFlow } from '@runner/flow';
import { getCatalog, type TypeCatalog } from '@core/notation';
import { findByFlowNode } from '@runner/nodes/registry';
import { draw, evaluateCondition } from '@runner/branching';
import { ScopeChain, type Scope } from '@runner/scope';
import type { Job } from '@runner/jobs';
import type { Studyflow } from '@runner/studyflow';
import { BPMN } from '@core/constants';
import { META_KEY, type StateTree } from '@core/document';

/** Nodes that route without a step of their own; the parse never keeps a ComplexGateway or a flow as a node. */
const ROUTING_TYPES: ReadonlySet<string> = new Set<string>([
  BPMN.ExclusiveGateway,
  BPMN.InclusiveGateway,
  BPMN.ParallelGateway,
  BPMN.EventBasedGateway,
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

  private seed?: number;
  private scopes: ScopeChain;
  private catalog: TypeCatalog;
  private onDiagnostic?: (message: string) => void;
  private trace: string[] = [];
  /** The run's copy of the file's `state` tree: scope writes mirror to `state.<declaring id>.<name>`; each visit of a
   * node, and each sequence flow followed, counts into `state._meta.reached.<id>`, as skills/local/run.py counts them. */
  private state: StateTree;

  constructor(studyflow: Studyflow, context: SessionContext = {}) {
    this.studyflow = studyflow;
    this.agentId = context.agentId;
    this.sessionId = context.sessionId;
    this.seed = context.seed;
    this.catalog = context.catalog ?? getCatalog();
    this.onDiagnostic = context.onDiagnostic;

    const root = studyflow.scopes.get(studyflow.rootScopeId);
    if (!root) throw new Error(`This studyflow has no study to run (no scope '${studyflow.rootScopeId}').`);
    this.state = structuredClone(studyflow.state);
    this.scopes = new ScopeChain(root);
    this.load(root);
    for (const [name, value] of Object.entries(context.variables ?? {})) this.write(name, value);
  }

  setVariable(name: string, value: unknown): void {
    this.write(name, value);
  }

  /** The `state` tree as the run has left it (never written back to the file by this runner). */
  getState(): StateTree {
    return this.state;
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
      this.count(node.id);

      if (node.type === 'bpmn:SubProcess') {
        const scope = this.studyflow.scopes.get(node.id);
        if (scope?.startId) {
          this.scopes.push(scope);
          delete this.state[scope.id]; // a sub-process instance starts from its declared values
          this.load(scope);
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

  /** Seeds a just-pushed frame: the tree's values win over declared initial `value`s, which are mirrored in; a
   * read-only property always holds its declared one. */
  private load(scope: Scope): void {
    const entry = this.state[scope.id] ?? {};
    for (const decl of scope.properties) {
      if (decl.name in entry && !decl.readOnly) this.scopes.write(decl.name, entry[decl.name], true);
      else if (decl.value !== undefined) this.write(decl.name, decl.value, true);
    }
  }

  private write(name: string, value: unknown, seeding = false): void {
    const scopeId = this.scopes.write(name, value, seeding);
    (this.state[scopeId] ??= {})[name] = value;
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

  private count(id: string): void {
    const reached = ((this.state[META_KEY] ??= {}).reached ??= {});
    reached[id] = (reached[id] ?? 0) + 1;
  }

  /** Follows the flow `node` leaves by, counting it; the node it leads to, or `undefined` at the end of the path. */
  private advance(node: FlowNode): string | undefined {
    const flow = this.pick(node);
    if (!flow) return undefined;
    this.count(flow.id);
    return flow.targetId;
  }

  private pick(node: FlowNode): SequenceFlow | undefined {
    if (node.outgoing.length === 0) return undefined;

    if (this.branchingMode(node) === 'random') return this.pickRandomBranch(node);
    if (this.isExclusiveGateway(node)) return this.pickConditionBranch(node) ?? this.pickDefaultBranch(node);
    return this.studyflow.sequenceFlows.get(node.outgoing[0]);
  }

  private branchingMode(node: FlowNode): string | undefined {
    if (!node.extensionType) return undefined;
    const mode = this.catalog.getType(node.extensionType)?.meta?.branching;
    return typeof mode === 'string' ? mode : undefined;
  }

  private isExclusiveGateway(node: FlowNode): boolean {
    return node.type === 'bpmn:ExclusiveGateway' || node.type === 'bpmn:InclusiveGateway';
  }

  /** Seeded, each visit draws from the seed, the gateway and the visit number (this one included), as run.py does. */
  private pickRandomBranch(node: FlowNode): SequenceFlow | undefined {
    const flows = node.outgoing
      .map((id) => this.studyflow.sequenceFlows.get(id))
      .filter((flow): flow is SequenceFlow => !!flow?.targetId);
    if (flows.length === 0) return undefined;
    const visit = this.trace.filter((id) => id === node.id).length;
    const u = this.seed != null ? draw(this.seed, node.id, visit) : Math.random();
    return flows[Math.floor(u * flows.length)];
  }

  private pickConditionBranch(node: FlowNode): SequenceFlow | undefined {
    for (const flowId of node.outgoing) {
      const flow = this.studyflow.sequenceFlows.get(flowId);
      if (flow?.conditionExpression
        && this.evalCondition(flow.conditionExpression, flowId, flow.conditionLanguage)) {
        return flow;
      }
    }
    return undefined;
  }

  /** No condition held: the default flow, else the one flow without a condition; else the run stops, as run.py's does. */
  private pickDefaultBranch(node: FlowNode): SequenceFlow {
    const byDefault = this.studyflow.sequenceFlows.get(node.businessObject?.default?.id);
    if (byDefault) return byDefault;
    const otherwise = node.outgoing
      .map((id) => this.studyflow.sequenceFlows.get(id))
      .filter((flow) => flow && !flow.conditionExpression);
    if (otherwise.length === 1) return otherwise[0]!;
    throw new Error(
      `No condition held at '${node.id}', and it has no default flow `
      + `${otherwise.length > 1 ? `but ${otherwise.length} flows without a condition` : 'and no flow without a condition'}. `
      + 'Mark one outgoing flow as the default in the modeler.',
    );
  }

  private conditionBindings(): Record<string, unknown> {
    const entries = [...this.trace];
    const trace = Object.assign(entries, {
      count: (value: unknown): number => entries.filter((entry) => entry === value).length,
    });
    return { ...this.scopes.bindings(), state: { ...this.state, trace } };
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
