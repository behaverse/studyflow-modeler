import { expect, test } from '@playwright/test';

import { checkStores } from '@core/checks/stores';
import { studyModel } from '@tests/schemas';

/** The data stores a study keeps for all its participants, each cited by its name. */

const study = (stores: string, property = 'arm'): string => `id: stores
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
${stores}
Study:
  type: Process
  name: Study
  properties:
    P_Arm:
      name: ${property}
  flowElements:
    Start: { type: StartEvent }
    Done: { type: EndEvent }
    F1: Start -> Done
`;

const store = (id: string, name: string): string => `${id}:\n  type: DataStore\n  name: ${name}\n`;

test('each data store has a name of its own, which the runner does not reserve and no property of a process hides', () => {
  // Each issue as `<severity> <element id>: <message>`.
  const CASES: [label: string, text: string, issues: string[]][] = [
    ['stores of their own names', study(store('Tally', 'tally') + store('Seen', 'seen')), []],
    ['two stores of one name', study(store('Tally', 'tally') + store('Tally_2', 'tally')), [
      "error Tally_2: data stores \"Tally\" and \"Tally_2\" are both named 'tally', which then cites only one",
    ]],
    ['a store named as the runner names its own', study(store('Meta', '_meta')), [
      'error Meta: data store "_meta": a name starting with _ is the runner\'s',
    ]],
    ['a property of the process named as a store', study(store('Tally', 'tally'), 'tally'), [
      "warning Study: \"Study\" declares a property named 'tally', which hides data store \"Tally\" inside it: rename one",
    ]],
  ];
  for (const [label, text, issues] of CASES) {
    expect(checkStores(studyModel(text)).map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`), label).toEqual(issues);
  }
});
