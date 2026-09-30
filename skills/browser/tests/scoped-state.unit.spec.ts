
import { expect, test } from '@playwright/test';

import { registerNode } from '@runner/nodes/registry';
import { Aborted, Session } from '@runner/session';
import { Studyflow } from '@runner/studyflow';
import type { FlowNode } from '@runner/flow';
import { loadSchemaModels, schemaPackages } from '@tests/schemas';

/** A session, this runtime's host of the walk: the jobs it yields, where a node's values land, the state it keeps.
 * How the study is walked is pinned by packages/core/tests/engine.unit.spec.ts. */

const packages: Record<string, any> = schemaPackages(loadSchemaModels());

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
  test('a read resolves outward, a write lands on the declaring scope, and an undeclared write is kept but reported', async () => {
    const studyflow = await load(NESTED);
    const session = new Session(studyflow);

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

test('a step refused leaves by its error boundary event when it carries one; else the run stops there', async () => {
  const consent = (boundary: string) => `${HEAD}Study:
  type: bpmn:Process
  flowElements:
    Start: { type: StartEvent }
    Consent: { type: Task }
${boundary}    Play: { type: Task }
    Done: { type: EndEvent }
    F1: Start -> Consent
    F2: Consent -> Play
    F3: Play -> Done
`;
  /** The steps shown, refusing `Consent`. */
  const refusing = async (study: string): Promise<string[]> => {
    const session = new Session(await load(study));
    const shown: string[] = [];
    for await (const job of session.traverse()) {
      shown.push(job.node.id);
      if (job.node.id === 'Consent') session.abort('consent-declined');
    }
    return shown;
  };
  const declined = `    Declined:
      type: BoundaryEvent
      attachedToRef: Consent
      eventDefinitions:
        Err: { type: ErrorEventDefinition }
    Excluded: { type: EndEvent }
    F4: Declined -> Excluded
`;
  expect(await refusing(consent(declined))).toEqual(['Start', 'Consent', 'Excluded']);
  await expect(refusing(consent(''))).rejects.toThrow(Aborted);
});

test('a screen whose step a timer ends is dropped: the page is told, and the next job is the timer\'s way on', async () => {
  let expire!: () => void;
  const expired = new Promise<void>((resolve) => { expire = resolve; });
  const session = new Session(await load(`${HEAD}Study:
  type: bpmn:Process
  flowElements:
    Start: { type: StartEvent }
    Slow: { type: Task }
    TooSlow:
      type: BoundaryEvent
      attachedToRef: Slow
      eventDefinitions:
        Timer: { type: TimerEventDefinition, timeDuration: PT0.05S }
    Done: { type: EndEvent }
    TimedOut: { type: EndEvent }
    F1: Start -> Slow
    F2: Slow -> Done
    F3: TooSlow -> TimedOut
`), { onExpired: () => expire() });
  const shown: string[] = [];
  for await (const job of session.traverse()) {
    shown.push(job.node.id);
    if (job.node.id === 'Slow') await expired; // the participant never finishes it
  }
  expect(shown).toEqual(['Start', 'Slow', 'TimedOut']);
});

test.describe('the state a session keeps', () => {
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

  test('a session yields each step a node has a screen for, and keeps the state the walk leaves; initial values seed the scopes', async () => {
    const studyflow = await load(REACH);
    const session = new Session(studyflow);
    expect(session.getVariables().total).toBe(0);

    const visited = await visits(session);

    // The gateway is counted before it decides: reached 1 and 2 loop back, 3 takes the default. The counts balance as
    // `studyflow validate` checks: Battery's 3 came by F_A and F_Loop and left by F_B, Gate's by F_Loop and F_Out.
    expect(visited.filter((id) => id === 'Trial')).toHaveLength(3);
    expect(visited[visited.length - 1]).toBe('Excluded');
    expect(session.getState()).toEqual({
      Study: { total: 0 },
      Battery: { failed: 0 },
      _meta: {
        reached: {
          Start: 1, F_A: 1, Battery: 3, T_Start: 3, F_T: 3, Trial: 3, F_T2: 3, T_End: 3, F_B: 3,
          Gate: 3, F_Loop: 2, F_Out: 1, Excluded: 1,
        },
      },
    });
    expect(session.getUndeclaredVariables()).toEqual([]);
  });

  test('a deposited state tree seeds the scopes and keeps accumulating its counters and prov', async () => {
    const studyflow = await load(`${REACH}state:\n  _meta: { prov: [{ action: executed }], reached: { Gate: 2 } }\n  Study: { total: 10 }\n`);
    expect(studyflow.state._meta.reached).toEqual({ Gate: 2 });

    const session = new Session(studyflow);
    expect(session.getVariables().total).toBe(10);
    const visited = await visits(session);

    // Gate was reached twice before this run, so its first visit here is the third: no loop.
    expect(visited.filter((id) => id === 'Trial')).toHaveLength(1);
    expect(session.getState().Study).toEqual({ total: 10 });
    expect(session.getState()._meta.prov).toEqual([{ action: 'executed' }]);
    expect(session.getState()._meta.reached.Gate).toBe(3);
  });
});
