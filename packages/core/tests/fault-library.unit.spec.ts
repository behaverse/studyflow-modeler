import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { YAML_DUMP_OPTIONS, protocolDigest, studyModelOf, studyflowToDefinitions } from '@core/document';
import { planChecks, recordChecks } from '@core/checks';
import { freshModdle } from '@tests/schemas';

/**
 * The fault library: faults seeded one at a time into a small study, each with what `studyflow validate` says of it,
 * the caught and the missed alike. The manuscript reports this table (its fault-library table), so a row's `fault`
 * is written for its reader.
 */

const PLAN = `id: fault_library
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  name: Fault library
  extensionElements:
    - type: studyflow:Study
      seed: 7
  flowElements:
    Start:
      type: StartEvent
      name: Enrolled
    Eligible:
      type: ExclusiveGateway
      name: Eligible?
      extensionElements:
        - type: cognitive:EligibilityGateway
      default: F_No
    Excluded:
      type: EndEvent
      name: Excluded (n={reached})
    Settings:
      type: DataObjectReference
      name: Task settings
      extensionElements:
        - type: studyflow:Parameters
          values:
            trials: 30
    Play:
      type: Task
      name: Play the task
      dataInputAssociations:
        In_Settings: { sourceRef: [Settings] }
      dataOutputAssociations:
        Out_Trials: { targetRef: Trials }
    Failed:
      type: BoundaryEvent
      name: Task failed
      attachedToRef: Play
      eventDefinitions:
        Error: { type: ErrorEventDefinition }
    Discontinued:
      type: EndEvent
      name: Discontinued (n={reached})
    Trials:
      type: DataStoreReference
      name: Trials
      extensionElements:
        - type: studyflow:Dataset
          schema: Trial_Schema
    Trial_Schema:
      type: DataObjectReference
      name: Trial schema
      extensionElements:
        - type: studyflow:Schema
          body:
            tableSchema:
              columns:
                - { name: subject, datatype: string }
                - { name: response_time, datatype: number }
                - { name: correct, datatype: boolean }
    Summarize:
      type: ServiceTask
      name: Accuracy per subject
      implementation: python://pandas.DataFrame.pivot_table
      additionalArguments:
        index: subject
        values: [correct, response_time]
      dataInputAssociations:
        In_Trials: { sourceRef: [Trials], transformation: self }
    Accurate:
      type: ExclusiveGateway
      name: Accurate enough?
    Below:
      type: EndEvent
      name: Below criterion (n={reached})
    Compare:
      type: ServiceTask
      name: Equivalent across arms?
      implementation: python://statsmodels.stats.weightstats.ttost_ind
      additionalArguments:
        low: -0.1
        upp: 0.1
    Done:
      type: EndEvent
      name: Completed (n={reached})
    F_Start: Start -> Eligible
    F_Yes:
      name: "yes"
      sourceRef: Eligible
      targetRef: Play
      conditionExpression: consented
    F_No:
      name: "no"
      sourceRef: Eligible
      targetRef: Excluded
    F_Played: Play -> Summarize
    F_Failed: Failed -> Discontinued
    F_Summarized: Summarize -> Accurate
    F_Pass:
      name: "yes"
      sourceRef: Accurate
      targetRef: Compare
      conditionExpression: accuracy >= 0.8
    F_Below:
      name: "no"
      sourceRef: Accurate
      targetRef: Below
      conditionExpression: accuracy < 0.8
    F_Compared: Compare -> Done
`;

/** What one run of ten subjects counts: two excluded, one discontinued, two below criterion, five completed. */
const REACHED = {
  Start: 10, F_Start: 10, Eligible: 10, F_Yes: 8, F_No: 2, Excluded: 2,
  Play: 8, F_Played: 7, Failed: 1, F_Failed: 1, Discontinued: 1,
  Summarize: 7, F_Summarized: 7, Accurate: 7, F_Pass: 5, F_Below: 2, Below: 2, Compare: 5, F_Compared: 5, Done: 5,
};

/** The plan as the run left it: its record, naming the protocol it walked, and its counts. */
const executed = async (): Promise<string> => PLAN + yaml.dump({
  state: {
    _meta: {
      prov: [{ action: 'executed', when: '2026-09-21T10:00:00Z', with: 'studyflow-cli/26.9', run: 'r1', seed: 7, plan: await digest(PLAN) }],
      reached: REACHED,
    },
  },
}, YAML_DUMP_OPTIONS);

const digest = async (text: string): Promise<string> => protocolDigest(studyModelOf(studyflowToDefinitions(text, freshModdle())));

/** `sha256:` and the first 12 hex digits, as the seal quotes a digest. */
const short = (sha: string): string => `${sha.slice(0, 19)}…`;

/** What `studyflow validate` prints of a file, but for its OK line: the reader's warnings or error, then the checks. */
async function validate(text: string): Promise<string[]> {
  const lines: string[] = [];
  let definitions: any;
  try {
    definitions = studyflowToDefinitions(text, freshModdle(), (warning) => lines.push(`warning: ${warning}`));
  } catch (error) {
    return [...lines, `error: ${(error as Error).message}`];
  }
  const record = await recordChecks(definitions);
  for (const { severity, message } of [...planChecks(definitions), ...record.issues]) lines.push(`${severity}: ${message}`);
  return lines;
}

/** An edit that swaps one spelling for another, and fails when the fixture no longer has it. */
const swap = (from: string, to: string) => (text: string): string => {
  expect(text).toContain(from);
  return text.replace(from, to);
};

type Fault = {
  /** The fault, in the words of the manuscript's table. */
  fault: string;
  /** The check that reports it, or `missed`. */
  check: 'reader' | 'soundness' | 'runner paths' | 'decisions' | 'data contract' | 'flow consistency' | 'seal' | 'missed';
  /** Seeded into the deposited plan, or into the copy a run stamped. */
  into: 'plan' | 'executed copy';
  edit: (text: string) => string;
  /** Every line `studyflow validate` prints of it, a pattern for a line that quotes a varying part. */
  says: (string | RegExp)[];
};

const FAULTS: Fault[] = [
  {
    fault: 'An exit count edited after the run',
    check: 'flow consistency',
    into: 'executed copy',
    edit: swap('Excluded: 2', 'Excluded: 1'),
    says: ['error: flow consistency at "Excluded (n={reached})": reached 1 != inflow 2 (1 unaccounted)'],
  },
  {
    fault: 'An analysis step reads a column its schema does not define',
    check: 'data contract',
    into: 'plan',
    edit: swap('values: [correct, response_time]', 'values: [correct, elapsed_time]'),
    says: ['error: "Accuracy per subject" reads column "elapsed_time", which schema "Trial schema" does not define (closest: "response_time")'],
  },
  {
    fault: 'A step on no path from the start to an end',
    check: 'soundness',
    into: 'plan',
    edit: swap('    Done:\n', '    Pilot:\n      type: Task\n      name: Pilot session\n    Done:\n'),
    says: ['error: "Pilot session" lies on no path from a start event to an end event: no start event leads to it'],
  },
  {
    fault: 'A parameter changed after the run',
    check: 'seal',
    into: 'executed copy',
    edit: swap('trials: 30', 'trials: 20'),
    says: [/^warning: protocol changed since run r1: recorded sha256:[0-9a-f]{12}…, now sha256:[0-9a-f]{12}…$/],
  },
  {
    fault: 'Parallel branches within one pool',
    check: 'runner paths',
    into: 'plan',
    edit: swap('      type: ExclusiveGateway\n      name: Accurate enough?', '      type: ParallelGateway\n      name: Accurate enough?'),
    says: ['error: "Accurate enough?" splits into 2 parallel paths; a pool walks one path, so the walk stops here'],
  },
  {
    fault: 'An inclusive gateway',
    check: 'runner paths',
    into: 'plan',
    edit: swap('      type: ExclusiveGateway\n      name: Accurate enough?', '      type: InclusiveGateway\n      name: Accurate enough?'),
    says: ['error: "Accurate enough?" is an inclusive gateway with 2 outgoing flows; a pool walks one path, so the walk stops here rather than take only the first whose condition holds'],
  },
  {
    fault: 'Two elements share an id',
    check: 'reader',
    into: 'plan',
    edit: swap('    Compare:\n', '    Summarize:\n'),
    says: [/^error: duplicated mapping key/],
  },
  {
    fault: 'A misspelled attribute',
    check: 'reader',
    into: 'plan',
    edit: swap('implementation: python://statsmodels', 'implmentation: python://statsmodels'),
    says: ["warning: unknown key 'implmentation' on bpmn:ServiceTask kept as a raw attribute (typo, or its schema is not loaded?)"],
  },
  {
    fault: 'A decision rule whose inequality is flipped before deposit',
    check: 'decisions',
    into: 'plan',
    edit: swap('accuracy >= 0.8', 'accuracy <= 0.8'),
    says: [
      'warning: "Accurate enough?": for accuracy in (-∞, 0.8), both "yes" and "no" hold, and the walk takes the first in the file\'s order',
      'error: "Accurate enough?": for accuracy in (0.8, ∞), no condition holds and there is no default flow, so the walk stops there',
    ],
  },
  {
    fault: 'A criterion moved in one branch only',
    check: 'decisions',
    into: 'plan',
    edit: swap('accuracy >= 0.8', 'accuracy >= 0.7'),
    says: ['warning: "Accurate enough?": for accuracy in [0.7, 0.8), both "yes" and "no" hold, and the walk takes the first in the file\'s order'],
  },
  {
    fault: 'A complex gateway',
    check: 'runner paths',
    into: 'plan',
    edit: swap('      type: ExclusiveGateway\n      name: Accurate enough?', '      type: ComplexGateway\n      name: Accurate enough?'),
    says: ['error: "Accurate enough?" is a complex gateway with 2 outgoing flows; the walk reads no activation rule, so it stops here rather than take it as an exclusive gateway'],
  },
  {
    fault: 'A difference test where the question asks for equivalence',
    check: 'missed',
    into: 'plan',
    edit: swap('python://statsmodels.stats.weightstats.ttost_ind\n      additionalArguments:\n        low: -0.1\n        upp: 0.1', 'python://scipy.stats.ttest_ind\n      additionalArguments:\n        equal_var: false'),
    says: [],
  },
];

test('the study the faults are seeded into passes, as deposited and as a run left it', async () => {
  expect(await validate(PLAN)).toEqual([]);
  const copy = await executed();
  expect(await validate(copy)).toEqual([]);
  expect((await recordChecks(studyflowToDefinitions(copy, freshModdle()))).note).toBe(`protocol matches run r1 (${short(await digest(PLAN))})`);
});

for (const { fault, check, into, edit, says } of FAULTS) {
  test(`${fault} (${into}): ${check}`, async () => {
    const lines = await validate(edit(into === 'plan' ? PLAN : await executed()));
    expect(lines).toHaveLength(says.length);
    says.forEach((line, i) => (typeof line === 'string' ? expect(lines[i]).toBe(line) : expect(lines[i]).toMatch(line)));
  });
}
