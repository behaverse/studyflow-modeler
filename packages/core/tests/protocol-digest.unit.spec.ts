import { expect, test } from '@playwright/test';

import { protocolDigest, xmlToStudy } from '@core/document';
import { freshMetamodel, studyModel, xmlOf, yamlOf } from '@tests/schemas';

/** The protocol digest a run records as its `plan`: the study without its drawing, its run state, or its run records. */

const PLAN = `id: digest_probe
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  name: Digest probe
  laneSets:
    Lanes:
      lanes:
        Lane_Task:
          name: Task
          flowNodeRef: [Start, Play]
          bounds: 0 0 600 120
        Lane_Exit:
          name: Exits
          flowNodeRef: [Gate, Done, Retry]
          bounds: 0 120 600 160
  flowElements:
    Start:
      type: StartEvent
      bounds: 40 42 36 36
    Play:
      type: Task
      name: Play the task
      documentation: Thirty trials of the n-back.
      checklist: |-
        - [ ] Settings wired in
      additionalArguments:
        level: 2
        blocks: [Test_A, Test_B]
      dataInputAssociations:
        In_Settings: { sourceRef: [Settings] }
      bounds: 120 20 100 80
    Settings:
      type: DataObjectReference
      name: Settings
      extensionElements:
        - type: studyflow:Parameters
          values:
            trials: 30
      bounds: 250 30 36 50
      label: 240 85 60 14
    Trial_Schema:
      type: DataObjectReference
      name: Trial schema
      extensionElements:
        - type: studyflow:Schema
          body: '{"tableSchema": {"columns": [{"name": "correct", "datatype": "boolean"}]}}'
    Gate:
      type: ExclusiveGateway
      name: Accurate enough?
      default: F_Retry
      bounds: 145 150 50 50
    Done:
      type: EndEvent
      bounds: 400 157 36 36
    Retry:
      type: EndEvent
      bounds: 400 227 36 36
    F1: Start -> Play
    F2: Play -> Gate
    F_Pass:
      sourceRef: Gate
      targetRef: Done
      conditionExpression: accuracy >= 0.8
    F_Retry: Gate -> Retry
`;

/** An edit that swaps one spelling for another, and fails when the fixture no longer has it. */
const swap = (from: string, to: string) => (text: string): string => {
  expect(text).toContain(from);
  return text.replace(from, to);
};

const digest = async (text: string): Promise<string> => protocolDigest(studyModel(text));

/** What a run leaves: its state (on a Study extension the file did not have), and a record on each element it ran. */
const RUN = (text: string): string => [
  swap('      documentation: Thirty', '      extensionElements:\n        - type: prov:Activity\n          action: executed\n          run: r1\n      documentation: Thirty'),
  swap('            trials: 30\n', '            trials: 30\n        - type: prov:Activity\n          action: created\n          run: r1\n'),
].reduce((edited, edit) => edit(edited), text) + `state:
  _meta:
    prov:
      - { action: executed, run: r1, plan: "sha256:0" }
    reached: { Start: 1, F1: 1, Play: 1 }
  Study: { accuracy: 0.9 }
`;

test('the drawing, the run state and the run records leave the digest alone; the protocol changes it', async () => {
  const base = await digest(PLAN);
  // By value, the one release 26.9.29 gives: a run's seal compares digests made by different builds, so the digest may
  // not move when BPMN holds the same protocol another way (since then, a checklist and arguments are XML attributes).
  expect(base).toBe('sha256:2c77de46c16644a1a19cad816971073baa0c2b9ea984ff1f8cc6cb47ff617102');

  const CASES: [label: string, edit: (text: string) => string | Promise<string>, changes: boolean][] = [
    ['a shape moves', swap('bounds: 120 20 100 80', 'bounds: 160 60 100 80'), false],
    ['a label moves', swap('label: 240 85 60 14', 'label: 300 85 60 14'), false],
    ['a colour', swap('bounds: 120 20 100 80', 'bounds: 120 20 100 80\n      fill: "#dbe6f2"'), false],
    ['an icon', swap('name: Play the task', 'name: Play the task\n      icon: iconify ph--star'), false],
    // The canvas files a shape into the lane it is dropped in.
    ['a shape moves into another lane', (text) => swap('[Gate, Done, Retry]', '[Play, Gate, Done, Retry]')(swap('[Start, Play]', '[Start]')(text)), false],
    ['a run stamps state and per-element records', RUN, false],
    // An audit after the run: a checklist item ticked off, a Gantt progress filled in.
    ['a checklist item ticked', swap('- [ ] Settings wired in', '- [x] Settings wired in'), false],
    ['a progress', swap('name: Play the task', 'name: Play the task\n      progress: done'), false],
    // How `studyflow run` keeps the executed copy: through BPMN XML and back, which respells the schema's JSON as YAML.
    ['the trip through XML and back', async (text) => yamlOf(await xmlOf(text)), false],
    ['a parameter value', swap('trials: 30', 'trials: 20'), true],
    ['an argument value', swap('level: 2', 'level: 3'), true],
    ['a condition expression', swap('accuracy >= 0.8', 'accuracy > 0.8'), true],
    ['documentation', swap('Thirty trials', 'Twenty trials'), true],
    ['a checklist item reworded', swap('Settings wired in', 'Settings wired in and checked'), true],
    ['an added element', swap('    F1: Start -> Play', '    Extra:\n      type: Task\n    F1: Start -> Play'), true],
    // A material registered by its content: the digest is the protocol's, so other content registered is a new protocol.
    ['a data element\'s digest', swap('      name: Settings\n', `      name: Settings\n      digest: sha256:${'0'.repeat(64)}\n`), true],
    ['a consent form\'s digest', swap('      type: StartEvent\n', `      type: StartEvent\n      consentFormDigest: sha256:${'0'.repeat(64)}\n`), true],
  ];
  for (const [label, edit, changes] of CASES) {
    expect(await digest(await edit(PLAN)) !== base, label).toBe(changes);
  }

  // Read from BPMN XML as `studyflow` reads it, with the data associations compacted: the same protocol.
  expect(await protocolDigest(await xmlToStudy(await xmlOf(PLAN), freshMetamodel()))).toBe(base);
});
