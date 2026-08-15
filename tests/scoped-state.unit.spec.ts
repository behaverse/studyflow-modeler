
import { expect, test } from '@playwright/test';

import { buildCatalog } from '@core/notation';
import { toModdlePackages } from '@core/notation/schemaFile';
import { registerNode } from '@runner/nodes/registry';
import { Session } from '@runner/session';
import { Studyflow } from '@runner/studyflow';
import { evaluateCondition, UndeclaredReference } from '@runner/branching';
import type { FlowNode } from '@runner/flow';
import { loadSchemaModels } from './schemas';

/** Scoped state at run time. */


const models = loadSchemaModels();
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const catalog = buildCatalog(models);

// Real node modules are `.tsx` views discovered by a Vite glob; register stand-ins — the walk is under test.
const nothing = () => null;
registerNode({
  type: 'start',
  match: { bpmnType: 'bpmn:StartEvent' },
  toJob: (node: FlowNode) => ({ type: 'start', node }),
  Component: nothing,
});
registerNode({
  type: 'end',
  match: { bpmnType: 'bpmn:EndEvent' },
  toJob: (node: FlowNode) => ({ type: 'end', node, completionCodeType: 'none' as const }),
  Component: nothing,
});
registerNode({
  type: 'task',
  match: { fallback: 'task' },
  toJob: (node: FlowNode) => ({ type: 'task', node }),
  Component: nothing,
});

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

    expect(studyflow.flowNodes.get('Trial')?.scopeId).toBe('Battery');
    expect(studyflow.flowNodes.get('Start')?.scopeId).toBe('Study');
  });

  test('the walk descends into a sub-process and resumes outside it', async () => {
    const studyflow = await load(NESTED);
    const session = new Session(studyflow, { catalog });

    const seen: string[] = [];
    for await (const job of session.traverse()) seen.push(job.node.id);

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

    expect(session.getVariables().arm).toBe('treatment');
    session.setVariable('failed_trials', 3);
    expect(session.getVariables().failed_trials).toBe(3);

    expect(session.getUndeclaredVariables()).toEqual([]);

    await walk.next(); // inner end -> scope closes
    await walk.next(); // outer End

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

  test('state.trace bounds a drawn back-edge instead of silently failing', async () => {
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
      conditionExpression: state.trace.count('Gate') < 3
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

    expect(visited.filter((id) => id === 'Work')).toHaveLength(3);
    expect(visited[visited.length - 1]).toBe('Done');
    expect(diagnostics).toEqual([]);
  });

  /** `__targetRef_placeholder` is bpmn-js's own invented `bpmn:Property` on the target activity. */
  test('bpmn-js\'s targetRef placeholder is not a participant variable', async () => {
    const WITH_PLACEHOLDER = `${HEAD}Study:
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
        P_Placeholder:
          name: __targetRef_placeholder
      flowElements:
        Trial_Start:
          type: bpmn:StartEvent
          outgoing: [Flow_T]
        Trial_End:
          type: bpmn:EndEvent
          incoming: [Flow_T]
        Flow_T:
          type: bpmn:SequenceFlow
          sourceRef: Trial_Start
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

    const studyflow = await load(WITH_PLACEHOLDER);

    const batteryScope = studyflow.scopes.get('Battery');
    expect(batteryScope, 'the sub-process must be a scope for this to be a real test').toBeTruthy();
    expect(batteryScope!.properties.map((p) => p.name)).not.toContain('__targetRef_placeholder');

    const session = new Session(studyflow, { catalog });
    for await (const _job of session.traverse()) { /* drive to completion */ }
    expect(Object.keys(session.getVariables())).not.toContain('__targetRef_placeholder');
  });

  test('a study with no start event starts at the node nothing flows into', async () => {
    const ONE_STEP = `${HEAD}Study:
  type: bpmn:Process
  flowElements:
    Only:
      type: bpmn:Task
`;
    const session = new Session(await load(ONE_STEP), { catalog });

    const visited: string[] = [];
    for await (const job of session.traverse()) visited.push(job.node.id);
    expect(visited).toEqual(['Only']);
  });

  test('two entry nodes and no start event stays an error rather than a guess', async () => {
    const AMBIGUOUS = `${HEAD}Study:
  type: bpmn:Process
  flowElements:
    First:
      type: bpmn:Task
    Second:
      type: bpmn:Task
`;
    const session = new Session(await load(AMBIGUOUS), { catalog });

    await expect((async () => {
      for await (const _job of session.traverse()) { /* unreachable */ }
    })()).rejects.toThrow(/no start event/);
  });
});
