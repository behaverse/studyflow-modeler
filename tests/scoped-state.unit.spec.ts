
import { expect, test } from '@playwright/test';

import { buildCatalog } from '../src/core/catalog';
import { toModdlePackages } from '../src/core/schema';
import { registerNode } from '../src/runner/controllers/nodes/registry';
import { Session } from '../src/runner/controllers/session';
import { Studyflow } from '../src/runner/models/studyflow';
import { evaluateCondition, UndeclaredReference } from '../src/runner/models/rng';
import type { FlowNode } from '../src/runner/models/flow';
import { loadSchemaModels } from './schemas';

/**
 * Scoped state at run time.
 *
 * The notation says a run's variables are `bpmn:Property` declarations bound
 * by the scope instance that owns them (BPMN 2.0 §10.4.7): entering a
 * sub-process opens a frame, leaving closes it, and a read walks outward.
 * These tests pin that the session actually behaves that way, rather than
 * keeping one flat bag as it used to.
 */


const models = loadSchemaModels();
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const catalog = buildCatalog(models);

// The real node modules are `.tsx` views discovered by a Vite glob, so this
// Node-side program registers stand-ins: the walk is what is under test, not
// what each node renders. Gateways deliberately match nothing — they route.
const stub = (type: string, match: any) =>
  registerNode({ type, match, toJob: (node: FlowNode) => ({ type, node }), Component: (() => null) as any });
stub('start', { bpmnType: 'bpmn:StartEvent' });
stub('end', { bpmnType: 'bpmn:EndEvent' });
stub('task', { fallback: 'task' });

const load = (yaml: string) => Studyflow.parse(yaml, structuredClone(packages));

const HEAD = `id: scoped
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
  expressionLanguage: https://github.com/google/cel-spec
  xmlns:bpmn: http://www.omg.org/spec/BPMN/20100524/MODEL
  xmlns:xsi: http://www.w3.org/2001/XMLSchema-instance
  xmlns:studyflow: http://behaverse.org/schemas/studyflow/v1
`;

/** Study declares `arm`; the battery sub-process declares `failed_trials`. */
const NESTED = `${HEAD}Study:
  type: bpmn:Process
  properties:
    P_Arm:
      name: arm
  flowElements:
    Start:
      type: bpmn:StartEvent
      outgoing: [Flow_A]
    Battery:
      type: bpmn:SubProcess
      incoming: [Flow_A]
      outgoing: [Flow_B]
      properties:
        P_Failed:
          name: failed_trials
      flowElements:
        Trial_Start:
          type: bpmn:StartEvent
          outgoing: [Flow_T]
        Trial:
          type: bpmn:Task
          incoming: [Flow_T]
          outgoing: [Flow_T2]
        Trial_End:
          type: bpmn:EndEvent
          incoming: [Flow_T2]
        Flow_T:
          type: bpmn:SequenceFlow
          sourceRef: Trial_Start
          targetRef: Trial
        Flow_T2:
          type: bpmn:SequenceFlow
          sourceRef: Trial
          targetRef: Trial_End
    End:
      type: bpmn:EndEvent
      incoming: [Flow_B]
    Flow_A:
      type: bpmn:SequenceFlow
      sourceRef: Start
      targetRef: Battery
    Flow_B:
      type: bpmn:SequenceFlow
      sourceRef: Battery
      targetRef: End
`;

test.describe('scoped state', () => {
  test('declarations are read per scope, and a sub-process is its own scope', async () => {
    const studyflow = await load(NESTED);

    expect(studyflow.rootScopeId).toBe('Study');
    expect(studyflow.scopes.get('Study')?.properties.map((p) => p.name)).toEqual(['arm']);
    expect(studyflow.scopes.get('Battery')?.properties.map((p) => p.name)).toEqual(['failed_trials']);
    expect(studyflow.scopes.get('Battery')?.parentId).toBe('Study');
    expect(studyflow.scopes.get('Battery')?.startId).toBe('Trial_Start');

    // Nodes from every depth are traversable, each tagged with its scope.
    expect(studyflow.flowNodes.get('Trial')?.scopeId).toBe('Battery');
    expect(studyflow.flowNodes.get('Start')?.scopeId).toBe('Study');
  });

  test('the walk descends into a sub-process and resumes outside it', async () => {
    const studyflow = await load(NESTED);
    const session = new Session(studyflow, { catalog });

    const seen: string[] = [];
    for await (const job of session.traverse()) seen.push(job.node.id);

    // The inner task runs; the inner end event closes the scope instead of
    // ending the run, so the outer end event is still reached.
    expect(seen).toContain('Trial');
    expect(seen[seen.length - 1]).toBe('End');
  });

  test('a read resolves outward, and a write lands on the declaring scope', async () => {
    const studyflow = await load(NESTED);
    const session = new Session(studyflow, { catalog });

    session.setVariable('arm', 'treatment');

    const walk = session.traverse();
    await walk.next(); // Start
    await walk.next(); // Trial — inside the battery scope

    // Inside the battery, the study's `arm` is visible without being copied in,
    // and the battery's own declaration is writable.
    expect(session.getVariables().arm).toBe('treatment');
    session.setVariable('failed_trials', 3);
    expect(session.getVariables().failed_trials).toBe(3);

    // Nothing here was undeclared: both names came from the file.
    expect(session.getUndeclaredVariables()).toEqual([]);

    await walk.next(); // inner end -> scope closes
    await walk.next(); // outer End

    // The battery's state went out of scope with it; the study's did not.
    expect(session.getVariables().arm).toBe('treatment');
    expect(session.getVariables().failed_trials).toBeUndefined();
  });

  test('an undeclared write is accepted but reported as undeclared', async () => {
    const session = new Session(await load(NESTED), { catalog });

    session.setVariable('end.completionCode', 'ABC123');

    expect(session.getVariables()['end.completionCode']).toBe('ABC123');
    expect(session.getUndeclaredVariables()).toEqual(['end.completionCode']);
  });
});

test.describe('conditions over declared state', () => {
  test('a declared-but-unwritten name evaluates; an undeclared one is a defect', () => {
    expect(evaluateCondition('arm == "treatment"', { arm: undefined }))
      .toEqual({ value: false });

    const undeclared = evaluateCondition('missing > 1', {});
    expect(undeclared.value).toBe(false);
    expect(undeclared.error).toContain('not declared');
  });

  test('an undeclared read raises a typed error rather than reading a global', () => {
    // `globalThis.Array` exists; the scope proxy must not let it through.
    const result = evaluateCondition('Array != null', {});
    expect(result.error).toContain('not declared');
    expect(new UndeclaredReference('x').name).toBe('UndeclaredReference');
  });

  test('state.visits bounds a drawn back-edge instead of silently failing', async () => {
    const LOOP = `${HEAD}Study:
  type: bpmn:Process
  properties:
    P_Score:
      name: score
  flowElements:
    Start:
      type: bpmn:StartEvent
      outgoing: [F1]
    Work:
      type: bpmn:Task
      incoming: [F1, F_Back]
      outgoing: [F2]
    Gate:
      type: bpmn:ExclusiveGateway
      incoming: [F2]
      outgoing: [F_Back, F_Out]
      default: F_Out
    Done:
      type: bpmn:EndEvent
      incoming: [F_Out]
    F1:
      type: bpmn:SequenceFlow
      sourceRef: Start
      targetRef: Work
    F2:
      type: bpmn:SequenceFlow
      sourceRef: Work
      targetRef: Gate
    F_Back:
      type: bpmn:SequenceFlow
      sourceRef: Gate
      targetRef: Work
      conditionExpression: state.visits.Gate < 3
    F_Out:
      type: bpmn:SequenceFlow
      sourceRef: Gate
      targetRef: Done
`;
    const diagnostics: string[] = [];
    const session = new Session(await load(LOOP), {
      catalog,
      onDiagnostic: (m) => diagnostics.push(m),
    });

    const visited: string[] = [];
    for await (const job of session.traverse()) visited.push(job.node.id);

    // The back-edge is taken while the gateway's visit count is under the
    // bound, then the default branch exits. Before the engine populated
    // `state.visits`, this condition threw and always took the exit.
    expect(visited.filter((id) => id === 'Work')).toHaveLength(3);
    expect(visited[visited.length - 1]).toBe('Done');
    expect(diagnostics).toEqual([]);
  });
});
