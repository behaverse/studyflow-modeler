
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { buildCatalog } from '@core/notation';
import { registerNode } from '@runner/nodes/registry';
import { Session } from '@runner/session';
import { Studyflow } from '@runner/studyflow';
import { draw, evaluateCondition } from '@runner/branching';
import type { FlowNode } from '@runner/flow';
import { loadSchemaModels, schemaPackages } from '@tests/schemas';

/** Scoped state at run time. */


const models = loadSchemaModels();
const packages: Record<string, any> = schemaPackages(models);
const catalog = buildCatalog(models);

// Real node modules are `.tsx` views discovered by a Vite glob; register stand-ins, the walk is under test.
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

/** The ids of the nodes a session's walk reaches, in order. */
async function visits(session: Session): Promise<string[]> {
  const visited: string[] = [];
  for await (const job of session.traverse()) visited.push(job.node.id);
  return visited;
}

const HEAD = `id: scoped
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
  expressionLanguage: https://github.com/google/cel-spec
  xmlns:bpmn: http://www.omg.org/spec/BPMN/20100524/MODEL
  xmlns:xsi: http://www.w3.org/2001/XMLSchema-instance
  xmlns:studyflow: http://behaverse.org/schemas/studyflow/v1
`;

/**
 * Study declares `arm`; the battery sub-process declares `failed_trials`, and carries the `__targetRef_placeholder`
 * property a data association targets until a real one is bound, which declares nothing.
 */
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
        P_Placeholder:
          name: __targetRef_placeholder
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

  test('a read resolves outward, a write lands on the declaring scope, and an undeclared write is kept but reported', async () => {
    const studyflow = await load(NESTED);
    const session = new Session(studyflow, { catalog });

    session.setVariable('arm', 'treatment');

    const walk = session.traverse();
    await walk.next(); // Start
    await walk.next(); // Trial, inside the battery scope

    expect(session.getVariables().arm).toBe('treatment');
    session.setVariable('failed_trials', 3);
    expect(session.getVariables().failed_trials).toBe(3);

    expect(session.getUndeclaredVariables()).toEqual([]);

    await walk.next(); // inner end -> scope closes
    await walk.next(); // outer End

    expect(session.getVariables().arm).toBe('treatment');
    expect(session.getVariables().failed_trials).toBeUndefined();

    // A write no scope declares is kept, and reported.
    session.setVariable('end.completionCode', 'ABC123');
    expect(session.getVariables()['end.completionCode']).toBe('ABC123');
    expect(session.getUndeclaredVariables()).toEqual(['end.completionCode']);
  });
});

test.describe('conditions over declared state', () => {
  test('a declared-but-unwritten name evaluates; an undeclared one is a defect, even one a global holds', () => {
    expect(evaluateCondition('arm == "treatment"', { arm: undefined }))
      .toEqual({ value: false });

    // `globalThis.Array` exists; the scope must not fall through to it.
    for (const expression of ['missing > 1', 'Array != null']) {
      const undeclared = evaluateCondition(expression, {});
      expect(undeclared.value, expression).toBe(false);
      expect(undeclared.error, expression).toContain('not declared');
    }
  });

  test('a study with no start event starts at the node nothing flows into; two such nodes are an error, not a guess', async () => {
    const ONE_STEP = `${HEAD}Study:
  type: bpmn:Process
  flowElements:
    Only:
      type: bpmn:Task
`;
    expect(await visits(new Session(await load(ONE_STEP), { catalog }))).toEqual(['Only']);

    const TWO_ENTRIES = `${ONE_STEP}    Second:
      type: bpmn:Task
`;
    await expect(visits(new Session(await load(TWO_ENTRIES), { catalog }))).rejects.toThrow(/no start event/);
  });
});

/** A gateway with no default flow whose one condition is false, and a flow without a condition to each of `bare`. */
const NO_DEFAULT = (bare: string[]) => `${HEAD}Study:
  type: bpmn:Process
  flowElements:
    Start:
      type: bpmn:StartEvent
      outgoing: [F1]
    Gate:
      type: bpmn:ExclusiveGateway
      incoming: [F1]
      outgoing: [F_No, ${bare.map((id) => `F_${id}`).join(', ')}]
    No:
      type: bpmn:EndEvent
      incoming: [F_No]
${bare.map((id) => `    ${id}:\n      type: bpmn:EndEvent\n      incoming: [F_${id}]\n`).join('')}    F1: Start -> Gate
    F_No:
      type: bpmn:SequenceFlow
      sourceRef: Gate
      targetRef: No
      conditionExpression: 1 > 2
${bare.map((id) => `    F_${id}: Gate -> ${id}\n`).join('')}`;

test.describe('which branch a gateway takes', () => {
  test('a seeded random gateway draws from the seed, the gateway and the visit', async () => {
    const studyflow = await load(readFileSync(path.join(process.cwd(), 'tests/fixtures/random-loop.studyflow.yaml'), 'utf8'));
    const visited = await visits(new Session(studyflow, { catalog, seed: studyflow.seed }));

    const arms = [1, 2, 3, 4].map((visit) => ['A', 'B'][Math.floor(draw(6, 'Draw', visit) * 2)]);
    expect(arms).toEqual(['A', 'A', 'B', 'A']);
    expect(visited).toEqual(['Start', ...arms, 'Done']);
  });

  test('no condition held and no default: the one flow without a condition is taken; with two, the run stops', async () => {
    expect(await visits(new Session(await load(NO_DEFAULT(['Otherwise'])), { catalog }))).toEqual(['Start', 'Otherwise']);
    await expect(visits(new Session(await load(NO_DEFAULT(['First', 'Second'])), { catalog })))
      .rejects.toThrow(/No condition held at 'Gate'.*2 flows without a condition/);
  });
});

test.describe('reach counts and initial values', () => {
  /** Study declares `total` (initial 0); the battery declares `failed`; the gateway loops while it has been reached under 3 times. */
  const REACH = `${HEAD}Study:
  type: bpmn:Process
  properties:
    P_Total:
      name: total
      value: "0"
  flowElements:
    Start:
      type: bpmn:StartEvent
      outgoing: [F_A]
    Battery:
      type: bpmn:SubProcess
      incoming: [F_A]
      outgoing: [F_B]
      properties:
        P_Failed:
          name: failed
          value: "0"
      flowElements:
        T_Start:
          type: bpmn:StartEvent
          outgoing: [F_T]
        Trial:
          type: bpmn:Task
          incoming: [F_T]
          outgoing: [F_T2]
        T_End:
          type: bpmn:EndEvent
          incoming: [F_T2]
        F_T:
          type: bpmn:SequenceFlow
          sourceRef: T_Start
          targetRef: Trial
        F_T2:
          type: bpmn:SequenceFlow
          sourceRef: Trial
          targetRef: T_End
    Gate:
      type: bpmn:ExclusiveGateway
      incoming: [F_B]
      outgoing: [F_Loop, F_Out]
      default: F_Out
    Excluded:
      type: bpmn:EndEvent
      name: Excluded (n={reached})
      incoming: [F_Out]
    F_A:
      type: bpmn:SequenceFlow
      sourceRef: Start
      targetRef: Battery
    F_B:
      type: bpmn:SequenceFlow
      sourceRef: Battery
      targetRef: Gate
    F_Loop:
      type: bpmn:SequenceFlow
      sourceRef: Gate
      targetRef: Battery
      conditionExpression: state._meta.reached.Gate < 3
    F_Out:
      type: bpmn:SequenceFlow
      sourceRef: Gate
      targetRef: Excluded
`;

  test('the runner counts every visit into state._meta.reached; initial values seed the scopes', async () => {
    const studyflow = await load(REACH);
    expect(studyflow.scopes.get('Study')?.properties[0].value).toBe(0);

    const session = new Session(studyflow, { catalog });
    expect(session.getVariables().total).toBe(0);

    const visited = await visits(session);

    // The gateway is counted before it decides: reached 1 and 2 loop back, 3 takes the default.
    expect(visited.filter((id) => id === 'Trial')).toHaveLength(3);
    expect(visited[visited.length - 1]).toBe('Excluded');
    expect(session.getState()).toEqual({
      Study: { total: 0 },
      Battery: { failed: 0 },
      _meta: { reached: { Start: 1, Battery: 3, T_Start: 3, Trial: 3, T_End: 3, Gate: 3, Excluded: 1 } },
    });
    expect(session.getUndeclaredVariables()).toEqual([]);
  });

  test('a deposited state tree seeds the scopes and keeps accumulating its counters and prov', async () => {
    const studyflow = await load(`${REACH}state:\n  _meta: { prov: [{ action: executed }], reached: { Gate: 2 } }\n  Study: { total: 10 }\n`);
    expect(studyflow.state._meta.reached).toEqual({ Gate: 2 });

    const session = new Session(studyflow, { catalog });
    expect(session.getVariables().total).toBe(10);
    const visited = await visits(session);

    // Gate was reached twice before this run, so its first visit here is the third: no loop.
    expect(visited.filter((id) => id === 'Trial')).toHaveLength(1);
    expect(session.getState().Study).toEqual({ total: 10 });
    expect(session.getState()._meta.prov).toEqual([{ action: 'executed' }]);
    expect(session.getState()._meta.reached.Gate).toBe(3);
  });
});
