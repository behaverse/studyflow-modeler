import { expect, test } from '@playwright/test';

import { checkRecorded } from '@core/checks/recorded';
import type { RunEvent } from '@core/engine';
import { studyModel } from '@tests/schemas';

test('an executed copy keeps the state its run\'s record says', () => {
  const file = (reached: number) => studyModel(`id: recorded
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
state:
  _meta:
    reached: { Start: ${reached} }
  S: { count: 2 }
`);
  const events: RunEvent[] = [
    { event: 'started', at: 't0', run: 'r', state: {}, stamp: { action: 'executed' } },
    { event: 'reached', at: 't1', id: 'Start' },
    { event: 'wrote', at: 't2', scope: 'S', name: 'count', value: 2 },
  ];
  expect(checkRecorded(file(1), events)).toEqual([]);
  expect(checkRecorded(file(2), events).map((issue) => issue.message))
    .toEqual(["the state this file keeps is not what its run's record says, from state._meta.reached.Start on: it was changed after the run"]);
});
