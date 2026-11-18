import { expect, test } from '@playwright/test';

import { sessionOf, spokenLength, spokenMinutes } from '@modeler/storyboard/session';
import { studyModel } from './schemas';

/** The session the storyboard tells: one participant's way through the study, with when each step begins. */

const STUDY = `id: session
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  name: Study
  flowElements:
    Start:
      type: StartEvent
    Read:
      type: Task
      name: Read the rules
      documentation: What the participant reads first.
      duration: 5min
    Gate:
      type: ExclusiveGateway
      default: F_b
    Skip:
      type: Task
    Play:
      type: Task
      duration: PT1H
    Survey:
      type: Task
    Done:
      type: EndEvent
    F1: Start -> Read
    F2: Read -> Gate
    F_a: Gate -> Skip
    F_b: Gate -> Play
    F3: Play -> Survey
    F4: Survey -> Done
    F5: Skip -> Done
`;

test('a session runs from the start along the default way, each step once, timed by the lengths it knows', () => {
  const session = sessionOf(studyModel(STUDY));
  expect(session.steps.map((step) => [step.id, step.at, step.via ?? null, step.ways ?? 1])).toEqual([
    ['Start', 0, null, 1],
    ['Read', 0, 'F1', 1],
    ['Gate', 5, 'F2', 2],
    ['Play', 5, 'F_b', 1],
    ['Survey', 65, 'F3', 1],
    ['Done', 65, 'F4', 1],
  ]);
  expect(session.steps[1]).toMatchObject({ name: 'Read the rules', description: 'What the participant reads first.', minutes: 5 });
  // The total counts what is known; a task with no length is counted apart.
  expect([session.total, session.unknown]).toEqual([65, 1]);

  const CASES: [minutes: number, spoken: string][] = [[0, '0 min'], [0.5, '30 s'], [45, '45 min'], [65, '1 h 5 min'], [2880, '2 d']];
  for (const [minutes, spoken] of CASES) expect(spokenMinutes(minutes)).toBe(spoken);
  // A length shows as written, but ISO 8601's in words.
  expect([spokenLength(session.steps[1]), spokenLength(session.steps[3])]).toEqual(['5min', '1 h']);
});
