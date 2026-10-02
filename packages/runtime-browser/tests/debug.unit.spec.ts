import { expect, test } from '@playwright/test';

import { describeForDebug, isDebug } from '@runner/debug';
import type { FlowNode } from '@runner/flow';
import { readParticipant, readSubjectId } from '@runner/subject';
import { studyModel } from '@tests/schemas';

/** The debug flag that stands name cards in for the heavy screens, and who is at the page. */

test('debug is on for the flag spellings a link actually carries, and off when absent or switched off', () => {
  for (const search of ['?debug=1', '?debug=true', '?debug', '?debug=', '?diagram=x&debug=yes']) expect(isDebug(search), search).toBe(true);
  for (const search of ['', '?diagram=x', '?debug=0', '?debug=false', '?debug=off']) expect(isDebug(search), search).toBe(false);
});

const model = studyModel(`id: d
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
P:
  type: Process
  flowElements:
    Task_DS_01: { type: Task, name: Digit Span, instrument: BM, timeline: Test }
    Task_7: { type: Task }
`);
const nodeOf = (id: string): FlowNode => ({ id, type: 'bpmn:Task', element: model.get(id)!, model, parameters: {}, outgoing: [], incoming: [] });

test('a card names the node and carries what tells the steps apart', () => {
  const card = describeForDebug(nodeOf('Task_DS_01'), 'behaverse');
  expect(card).toEqual({
    name: 'Digit Span',
    kind: 'behaverse',
    details: { id: 'Task_DS_01', instrument: 'BM', timeline: 'Test' },
  });
});

test('a card falls back to the id when the node is unnamed', () => {
  expect(describeForDebug(nodeOf('Task_7'), 'questionnaire').name).toBe('Task_7');
});

test('a session is the participant the link names, from 1, and nothing else counts', () => {
  expect(readParticipant({ participant: ' 3 ' })).toBe(3);
  for (const participant of ['0', '-1', '2.5', 'P3', '']) expect(readParticipant({ participant }), participant).toBeUndefined();
  expect(readParticipant({ subject_id: 'P042' })).toBeUndefined();
});

test('the subject id is read under the spellings in use, and blanks do not count', () => {
  expect(readSubjectId({ subjectId: ' P042 ' })).toBe('P042');
  expect(readSubjectId({ participant_id: 'P9' })).toBe('P9');
  expect(readSubjectId({ subject_id: '   ' })).toBeUndefined();
  expect(readSubjectId({})).toBeUndefined();
});
