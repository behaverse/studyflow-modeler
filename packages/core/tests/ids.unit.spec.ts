import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { checkIds } from '@core/checks/ids';
import { freshModdle } from '@tests/schemas';

test('an id two scopes each give an element is refused: a reference reaches one, and a run keeps one', () => {
  const study = (inner: string): string => `id: ids
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Sub:
      type: SubProcess
      flowElements:
        S0: { type: StartEvent }
        ${inner}: { type: Task, name: inner }
        S9: { type: EndEvent }
        SF0: S0 -> ${inner}
        SF1: ${inner} -> S9
    Work: { type: Task, name: outer }
    Done: { type: EndEvent }
    F0: Start -> Sub
    F1: Sub -> Work
    F2: Work -> Done
`;
  expect(checkIds(studyflowToDefinitions(study('Inner'), freshModdle(), () => {}))).toEqual([]);
  expect(checkIds(studyflowToDefinitions(study('Work'), freshModdle(), () => {}))).toEqual([{
    severity: 'error', elementId: 'Work', message: 'the id "Work" names 2 elements ("inner", "outer"): a reference to it reaches only one, and a run keeps one',
  }]);
});
