import { expect, test } from '@playwright/test';

import { checkDecisions } from '@core/checks/decisions';
import { studyModel } from '@tests/schemas';

/** An exclusive gateway's conditions on one number: an overlap leaves the choice to the flows' order, and a gap with
 * no default stops the walk. The fault library (fault-library.unit.spec.ts) shows the faults this catches. */

const gate = (yes: string, no: string, fallback = ''): string => `id: decisions
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    Start: { type: StartEvent }
    Gate: { type: ExclusiveGateway${fallback} }
    A: { type: EndEvent }
    B: { type: EndEvent }
    C: { type: EndEvent }
    F0: Start -> Gate
    F_Yes: { sourceRef: Gate, targetRef: A, conditionExpression: "${yes}" }
    F_No: { sourceRef: Gate, targetRef: B, conditionExpression: "${no}" }
    F_Else: Gate -> C
`;

test('conditions on one number that overlap, or leave a value no flow takes, are reported; others are left alone', () => {
  // [label, one condition, the other, a default flow?, what the check says as `<severity>: <fragment>`]
  const CASES: [string, string, string, boolean, string[]][] = [
    ['complementary', 'x >= 0.8', 'x < 0.8', true, []],
    ['a gap a default flow takes', 'x > 0.8', 'x < 0.5', true, []],
    ['the number written first', '0.8 <= x', 'x < 0.8', true, []],
    ['a band and its outside', 'x >= 1 and x <= 3', 'x < 1 or x > 3', true, []],
    ['overlapping bands', 'x >= 1 and x <= 3', 'x >= 2', true, ['warning: in [2, 3], both']],
    ['one value out', 'x != 2', 'x < 2', true, ['warning: in (-∞, 2), both']],
    ['two names', 'x > 1', 'y > 1', true, []],
    ['not a comparison with numbers', 'contains(answer, \\"yes\\")', 'x > 1', true, []],
  ];
  for (const [label, yes, no, fallback, says] of CASES) {
    const issues = checkDecisions(studyModel(gate(yes, no, fallback ? ', default: F_Else' : '')));
    expect(issues.map((issue) => `${issue.severity}: ${issue.message}`), label).toEqual(says.map((fragment) => expect.stringContaining(fragment.split(': ')[1])));
    issues.forEach((issue, index) => expect(issue.severity, label).toBe(says[index].split(':')[0]));
  }
  // Without the default flow, a value no condition holds for stops the walk.
  const stuck = checkDecisions(studyModel(gate('x > 0.8', 'x < 0.5').replace('    F_Else: Gate -> C\n', '')));
  expect(stuck.map((issue) => `${issue.severity}: ${issue.message}`)).toEqual(['error: "Gate": for x in [0.5, 0.8], no condition holds and there is no default flow, so the walk stops there']);
});

test('an inclusive gateway that never takes two flows at once is reported as a decision; one that may is left alone', () => {
  const says = (text: string): string[] => checkDecisions(studyModel(text)).map((issue) => `${issue.severity}: ${issue.message}`);
  const inclusive = (yes: string, no: string, fallback: boolean): string => {
    const text = gate(yes, no, fallback ? ', default: F_Else' : '').replace('ExclusiveGateway', 'InclusiveGateway');
    return fallback ? text : text.replace('    F_Else: Gate -> C\n', '');
  };
  const decision = 'warning: "Gate" is an inclusive gateway, but no two of the conditions on "F_Yes", "F_No" hold together, so it never takes more than one flow: make it an exclusive gateway';
  // [label, one condition, the other, a default flow?, warned?]
  const CASES: [string, string, string, boolean, boolean][] = [
    ['conditions that exclude each other', 'x >= 0.8', 'x < 0.8', false, true],
    ['conditions that exclude each other, and a default flow', 'x > 0.8', 'x < 0.5', true, true],
    ['conditions that can hold together', 'x >= 0.5', 'x >= 0.8', false, false],
    ['two names', 'x > 1', 'y > 1', false, false],
    ['not a comparison with numbers', 'contains(answer, \\"yes\\")', 'x > 1', false, false],
  ];
  for (const [label, yes, no, fallback, warned] of CASES) expect(says(inclusive(yes, no, fallback)), label).toEqual(warned ? [decision] : []);
  // One condition and a default flow: the default is taken only when the condition fails, so never both.
  expect(says(inclusive('x >= 0.8', 'x < 0.8', true).replace(/ {4}F_No: .*\n/, ''))).toEqual([
    'warning: "Gate" is an inclusive gateway, but it takes its default flow "F_Else" only when the condition on "F_Yes" fails, so it never takes more than one flow: make it an exclusive gateway',
  ]);
});
