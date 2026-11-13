import { expect, test } from '@playwright/test';

import { collectScheduleRows } from '@modeler/schedule/rows';
import reporting from '@skills/reporting-guidelines/modeler';
import { consortFlow } from '@skills/reporting-guidelines/modeler/consort';
import { participantFlowOf } from '@skills/reporting-guidelines/modeler/participantFlow';
import { spiritSchedule } from '@skills/reporting-guidelines/modeler/spirit';
import { studyModel } from '@tests/schemas';
import { exampleNames, exampleText } from '@tests/utils';
import { loadYaml } from '../../../packages/canvas/tests/canvasHarness';

/** The documents the skill reads off a study and hands the modeler: the participant flow, CONSORT's wording of it,
 * SPIRIT's schedule. */

/**
 * A small trial with every way a participant flow is read: an exit before allocation through a boundary event and
 * through the screen, an arm with an activity of its own and one without, an exit that says what it counts as, a timer
 * and a condition that do not, and a session whose task is marked at the session.
 */
const TRIAL = `schemas:
  cognitive: http://behaverse.org/schemas/studyflow/cognitive
  reporting: https://w3id.org/studyflow/reporting
  studyflow: http://behaverse.org/schemas/studyflow/v1

Trial:
  type: Process
  name: A small trial
  laneSets:
    Phases:
      lanes:
        Lane_Enrollment:
          name: Enrollment
          nodes:
            - $Start
            - $Screen
            - $Withdrew
            - $Eligible
            - $Unfit
            - $Allocate
        Lane_FollowUp:
          name: Follow-up
          nodes:
            - $Train
            - $Refused
            - $Wait
            - $Visit
            - $Late
            - $Poor
            - $Done
            - $Left
  elements:
    Start:
      type: StartEvent
      name: Enrolled
      onset: T0
    Screen:
      type: Task
      name: Screening (n={reached})
      onset: T0
      duration: 10min
    Withdrew:
      type: BoundaryEvent
      name: withdrew consent
      attachedTo: $Screen
      error: true
    Eligible:
      type: ExclusiveGateway
      name: Eligible?
      default: $To_Unfit
      extensions:
        cognitive:EligibilityGateway:
          inclusionCriteria:
            - Aged 18 or over
    Unfit:
      type: EndEvent
      name: Excluded (n={reached})
    Allocate:
      type: ExclusiveGateway
      name: Which group?
      extensions:
        cognitive:RandomGateway: {}
    Train:
      type: Task
      name: Training
      onset: T0+1d
      duration: 2d
    Refused:
      type: BoundaryEvent
      attachedTo: $Train
      error: true
      attrition: not-received
    Wait:
      type: IntermediateCatchEvent
      name: Wait
      timer: P4D
    Visit:
      type: SubProcess
      name: Visit (n={reached})
      onset: T0+7d
      duration: 1h
      elements:
        V_Start:
          type: StartEvent
        Stroop:
          type: Task
          name: Stroop task
          onset: T0+7d
          duration: 10min
          extensions:
            cognitive:CognitiveTask:
              platform: jspsych
        V_End:
          type: EndEvent
        V1: V_Start -> Stroop
        V2: Stroop -> V_End
    Late:
      type: BoundaryEvent
      name: Return window
      attachedTo: $Visit
      timer: P1D
      onset: T0+7d
    Poor:
      type: BoundaryEvent
      attachedTo: $Visit
      condition: errors > 3
    Done:
      type: EndEvent
      name: Completed (n={reached})
    Left:
      type: EndEvent
      name: Left early (n={reached})
    F1: Start -> Screen
    F2: Screen -> Eligible
    To_Unfit:
      name: "no"
      source: $Eligible
      target: $Unfit
    To_Allocate:
      name: "yes"
      source: $Eligible
      target: $Allocate
      condition: age >= 18
    A_Train:
      name: treatment (n={reached})
      source: $Allocate
      target: $Train
    A_Control:
      name: control (n={reached})
      source: $Allocate
      target: $Wait
    F_Train: Train -> Wait
    F_Wait: Wait -> Visit
    F_Done: Visit -> Done
    F_Withdrew: Withdrew -> Left
    F_Refused: Refused -> Left
    F_Late:
      name: did not come back (n={reached})
      source: $Late
      target: $Left
    F_Poor:
      name: too many errors (n={reached})
      source: $Poor
      target: $Left
`;

/** The record a run of twelve left: one withdrew, one was screened out, ten were allocated, six completed. */
const RUN = `
state:
  _meta:
    reached:
      Start: 12
      Screen: 12
      Withdrew: 1
      Eligible: 11
      To_Unfit: 1
      To_Allocate: 10
      Allocate: 10
      A_Train: 5
      A_Control: 5
      Train: 5
      Refused: 1
      Wait: 9
      Visit: 9
      Late: 2
      Poor: 1
      F_Done: 6
      Done: 6
`;

test('the participant flow counts who entered, who left before allocation and why, each arm, the exits by what they count as, and who completed', () => {
  const flow = participantFlowOf(studyModel(TRIAL + RUN))!;
  expect(flow).toMatchObject({ entered: 12, allocated: 10, screening: { id: 'Eligible' } });
  // Before allocation every way out is an exclusion: through a boundary event by its name, through the screen by its criterion.
  expect(flow.excluded).toEqual([
    { id: 'Withdrew', reason: 'Withdrew consent', n: 1, attrition: 'excluded' },
    { id: 'To_Unfit', reason: 'Not meeting inclusion criterion: Aged 18 or over', n: 1, attrition: 'excluded' },
  ]);
  // An arm keeps what only it does: the one turned away from training is no longer among those who received it, and
  // the control arm, with no activity of its own, says nothing of receiving.
  expect(flow.arms).toEqual([
    { id: 'A_Train', name: 'Treatment', allocated: 5, received: 4, exits: [{ id: 'Refused', reason: 'Left early', n: 1, attrition: 'not-received' }] },
    { id: 'A_Control', name: 'Control', allocated: 5, exits: [] },
  ]);
  // Past where the arms join, a timer unsaid is a loss to follow-up and a condition a discontinuation, each named by its flow.
  expect(flow.shared).toEqual({
    exits: [
      { id: 'Late', reason: 'Did not come back', n: 2, attrition: 'lost-to-follow-up' },
      { id: 'Poor', reason: 'Too many errors', n: 1, attrition: 'discontinued' },
    ],
    completed: 6,
  });

  const cases: [string, (text: string) => string, (flow: NonNullable<ReturnType<typeof participantFlowOf>>) => void][] = [
    ['no run: every count is 0', (text) => text.replace(RUN, ''), (read) => {
      expect(read).toMatchObject({ entered: 0, allocated: 0, shared: { completed: 0 } });
      expect(read.arms.map((arm) => arm.allocated)).toEqual([0, 0]);
    }],
    ['an exit that does not say is a discontinuation, and takes no one from those who received', (text) => text.replace('      attrition: not-received\n', ''), (read) => {
      expect(read.arms[0]).toMatchObject({ received: 5, exits: [{ id: 'Refused', attrition: 'discontinued' }] });
    }],
    ['a boundary event whose path goes on to the end is no exit', (text) => text.replace('      attrition: not-received\n', '').replace('F_Refused: Refused -> Left', 'F_Refused: Refused -> Wait'), (read) => {
      expect(read.arms[0]).toMatchObject({ received: 5, exits: [] });
    }],
    ['unless it says what it counts as: one who did not receive the intervention and is followed up all the same', (text) => text.replace('F_Refused: Refused -> Left', 'F_Refused: Refused -> Wait'), (read) => {
      expect(read.arms[0]).toMatchObject({ received: 4, exits: [{ id: 'Refused', reason: 'Reason not given', attrition: 'not-received' }] });
    }],
  ];
  for (const [name, edit, check] of cases) {
    const edited = edit(TRIAL + RUN);
    expect(edited, name).not.toBe(TRIAL + RUN);
    check(participantFlowOf(studyModel(edited))!);
  }

  // No gateway that draws its branch, no participant flow.
  expect(participantFlowOf(studyModel(TRIAL.replace('cognitive:RandomGateway: {}', 'cognitive:EligibilityGateway: {}')))).toBeUndefined();
});

test('CONSORT words the flow box by box: a column per arm while they keep paths of their own, one box across them after', () => {
  const model = studyModel(TRIAL + RUN);
  expect(consortFlow(model, participantFlowOf(model)!)).toEqual({
    study: 'A small trial',
    assessed: 'Assessed for eligibility (n=12)',
    excluded: [
      { text: 'Excluded (n=2)', style: 'head' },
      { text: 'Withdrew consent (n=1)', style: 'sub' },
      { text: 'Not meeting inclusion criterion: Aged 18 or over (n=1)', style: 'sub' },
    ],
    randomized: 'Randomized (n=10)',
    arms: 2,
    rows: [
      {
        phase: 'Allocation',
        cells: [
          [
            { text: 'Allocated to Treatment (n=5)', style: 'head' },
            { text: 'Received allocated intervention (n=4)', style: 'plain' },
            { text: 'Did not receive allocated intervention (n=1)', style: 'head' },
            { text: 'Left early (n=1)', style: 'sub' },
          ],
          [{ text: 'Allocated to Control (n=5)', style: 'head' }],
        ],
      },
      {
        phase: 'Follow-up',
        across: [
          { text: 'Both groups', style: 'head' },
          { text: 'Lost to follow-up (n=2)', style: 'head' },
          { text: 'Did not come back (n=2)', style: 'sub' },
          { text: 'Discontinued intervention (n=1)', style: 'head' },
          { text: 'Too many errors (n=1)', style: 'sub' },
        ],
      },
      { phase: 'Analysis', across: [{ text: 'Analyzed, both groups (n=6)', style: 'head' }] },
    ],
  });
});

test('SPIRIT tables the schedule: a visit a column, a lane a study period, a wait a bar between visits', () => {
  const { study } = loadYaml(TRIAL).canvas;
  expect(spiritSchedule(study.model, collectScheduleRows({ study }))).toEqual({
    study: 'A small trial',
    // Allocation sits in the enrollment lane here, so that period holds its column too; the last column is where
    // the return window ends, a day after the visit.
    periods: [{ name: 'Enrollment', span: 2 }, { name: 'Follow-up', span: 3 }],
    columns: ['T0', '+10 min', '+1 d', '+1 w', '+8 d'],
    sections: [
      {
        title: 'Enrollment',
        items: [
          { label: 'Enrolled', marks: [0], bars: [] },
          { label: 'Screening', marks: [0], bars: [] },
          { label: 'Allocation', marks: [1], bars: [] },
        ],
      },
      // A step only one arm does is its intervention; a task is an assessment, marked at the visit that holds it.
      { title: 'Interventions', items: [{ label: 'Training', marks: [2], bars: [] }] },
      { title: 'Assessments', items: [{ label: 'Stroop task', marks: [3], bars: [] }] },
      // The rest sits under its lane: the wait from the visit before it to the one it ends at, the window to its end.
      {
        title: 'Follow-up',
        items: [
          { label: 'Wait', marks: [], bars: [[2, 3]] },
          { label: 'Return window', marks: [], bars: [[3, 4]] },
        ],
      },
    ],
  });
});

test('the skill hands the modeler one document per guideline document, and each draws every shipped example or says why not', () => {
  const documents = reporting.documents;
  expect(documents.map((document) => document.id)).toEqual(['consort-2025-flow', 'spirit-2025-schedule']);
  const drawn = (name: string, id: string): string => {
    const { study } = loadYaml(exampleText(name), { onWarning: () => {} }).canvas;
    const figure = documents.find((document) => document.id === id)!.draw({ study });
    return 'svg' in figure ? figure.svg : `unavailable: ${figure.unavailable}`;
  };
  for (const name of exampleNames) {
    for (const { id } of documents) expect(drawn(name, id), `${name} ${id}`).toMatch(/^(<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" |unavailable: \S)/);
  }
  // The skill's own examples: CONSORT's says what each exit counts as, the statement's four in each arm, and SPIRIT's
  // draws its lanes as the study periods.
  const consort = participantFlowOf(studyModel(exampleText('consort2025')))!;
  for (const arm of consort.arms) {
    expect(arm.exits.map((exit) => exit.attrition), arm.name).toEqual(['not-received', 'lost-to-follow-up', 'discontinued', 'excluded-from-analysis']);
  }
  const { study } = loadYaml(exampleText('spirit2025')).canvas;
  expect(spiritSchedule(study.model, collectScheduleRows({ study }))!.periods.map((period) => period.name))
    .toEqual(['Enrolment', 'Allocation', 'Post-allocation', 'Close-out']);
});
