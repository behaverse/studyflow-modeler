import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { checkRecorded } from '@core/checks/recorded';
import type { RunEvent } from '@core/engine';
import { freshModdle } from '@tests/schemas';

test('an executed copy keeps the state its run\'s record says, the timeline aside', () => {
  const file = (reached: number, prov: string) => studyflowToDefinitions(`id: recorded
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
state:
  _meta:
    prov: [${prov}]
    reached: { Start: ${reached} }
  S: { count: 2 }
`, freshModdle());
  const events: RunEvent[] = [
    { event: 'started', at: 't0', run: 'r', state: { _meta: { prov: [{ action: 'executed' }] } }, stamp: { action: 'executed' } },
    { event: 'reached', at: 't1', id: 'Start' },
    { event: 'wrote', at: 't2', scope: 'S', name: 'count', value: 2 },
  ];
  expect(checkRecorded(file(1, '{ action: executed }'), events)).toEqual([]);
  // The modeler adds to the timeline when the file is saved again; that is no change to what the run left.
  expect(checkRecorded(file(1, '{ action: executed }, { action: modified }'), events)).toEqual([]);
  expect(checkRecorded(file(2, '{ action: executed }'), events).map((issue) => issue.message))
    .toEqual(["the state this file keeps is not what its run's record says, from state._meta.reached.Start on: it was changed after the run"]);
});
