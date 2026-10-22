import { expect, test } from '@playwright/test';
import { protocolDigest } from '@core/document';
import { checkSeal } from '@core/checks/seal';
import { studyModel } from '@tests/schemas';

/** The seal: the protocol digest the newest run recorded, against the protocol the file holds now. */

const PLAN = `id: sealed
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Play:
      type: Task
      name: Play 30 trials
    Done:
      type: EndEvent
    F1: Start -> Play
    F2: Play -> Done
`;

/** `plan` with `records` on its root, as the runs and the modeler leave them. */
const stamped = (plan: string, records: object[]): string =>
  plan.replace('  type: Process\n', `  type: Process\n  prov:Activity:\n${records.map((record) => `    - ${JSON.stringify(record)}\n`).join('')}`);

const short = (digest: string): string => `${digest.slice(0, 19)}…`;

test('validate says which run the protocol still matches, and warns once it no longer does', async () => {
  const digest = await protocolDigest(studyModel(PLAN));
  const edited = PLAN.replace('Play 30 trials', 'Play 20 trials');
  const now = await protocolDigest(studyModel(edited));
  const RUNS = [
    { action: 'created', who: 'author' },
    { action: 'executed', run: 'r1', plan: 'sha256:0000000000000000' },
    { action: 'executed', run: 'r2', plan: digest },
    { action: 'executed', run: 'r3' }, // started without `studyflow run`: no digest to check
  ];

  const CASES: [label: string, yaml: string, result: Awaited<ReturnType<typeof checkSeal>>][] = [
    ['no run recorded a protocol', stamped(PLAN, [RUNS[0], RUNS[3]]), { issues: [] }],
    ['the newest recorded protocol is the one the file holds', stamped(PLAN, RUNS), { issues: [], note: `protocol matches run r2 (${short(digest)})` }],
    ['the protocol changed after the run', stamped(edited, RUNS), {
      issues: [{ severity: 'warning', message: `protocol changed since run r2: recorded ${short(digest)}, now ${short(now)}` }],
    }],
  ];
  for (const [label, text, result] of CASES) {
    expect(await checkSeal(studyModel(text)), label).toEqual(result);
  }
});
