import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { YAML_DUMP_OPTIONS, protocolDigest, studyflowToDefinitions } from '@core/document';
import { checkSeal } from '@core/checks/seal';
import { freshModdle } from '@tests/schemas';

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

const stamped = (plan: string, prov: object[]): string => plan + yaml.dump({ state: { _meta: { prov } } }, YAML_DUMP_OPTIONS);

const short = (digest: string): string => `${digest.slice(0, 19)}…`;

test('validate says which run the protocol still matches, and warns once it no longer does', async () => {
  const digest = await protocolDigest(studyflowToDefinitions(PLAN, freshModdle()));
  const edited = PLAN.replace('Play 30 trials', 'Play 20 trials');
  const now = await protocolDigest(studyflowToDefinitions(edited, freshModdle()));
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
    expect(await checkSeal(studyflowToDefinitions(text, freshModdle())), label).toEqual(result);
  }
});
