import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { checkDataContract } from '@core/checks/data-contract';
import { freshModdle } from '@tests/schemas';

/** The data contract: a step names, in its arguments, only columns of the schema bound to the dataset it reads. */

/** CSVW, as a `.studyflow.yaml` file keeps the JSON the schema editor writes: folded into YAML. */
const CSVW = `
            tableSchema:
              columns:
                - { name: subject, datatype: string }
                - { name: response_time, datatype: number }
                - { name: correct, datatype: boolean }`;

const LINKML = `
            classes:
              Trial:
                attributes:
                  subject: { range: string }
                  correct: { range: boolean }`;

const JSON_BODY = ` '{"tableSchema": {"columns": [{"name": "subject"}, {"name": "correct"}]}}'`;

/** A dataset bound (`bound`) to a schema of `body`, read by a python:// step passing `args`. */
const study = (args: string, { body = CSVW, bound = true } = {}): string => `id: contract
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  flowElements:
    Trials:
      type: DataStoreReference
      name: Trials
      extensionElements:
        - type: studyflow:Dataset${bound ? '\n          schema: Trial_Schema' : ''}
    Trial_Schema:
      type: DataObjectReference
      name: Trial schema
      extensionElements:
        - type: studyflow:Schema
          body:${body}
    Summarize:
      type: ServiceTask
      name: Mean accuracy per subject
      implementation: python://pandas.DataFrame.pivot_table
      additionalArguments: ${args}
      dataInputAssociations:
        In_Trials: { sourceRef: [Trials], transformation: self }
`;

const UNDEFINED = (name: string, closest?: string): string =>
  `Summarize: "Mean accuracy per subject" reads column "${name}", which schema "Trial schema" does not define${closest ? ` (closest: "${closest}")` : ''}`;

test('the columns a step names must be the ones the schema of the data it reads defines', () => {
  // Each issue as `<element id>: <message>`.
  const CASES: [label: string, yaml: string, issues: string[]][] = [
    ['every column it names is defined', study('{ index: subject, values: [correct, response_time] }'), []],
    ['a misspelled column, and the closest the schema has', study('{ index: subject, values: [correct, elapsed_time] }'), [UNDEFINED('elapsed_time', 'response_time')]],
    ['a column nothing defined is near', study('{ index: participant }'), [UNDEFINED('participant')]],
    [
      'each column argument, a string or a list; a nested key or another argument is not a column',
      study('{ subset: [correct], by: subject, key: correct, column: [response_time], on: subject, usecols: [subject], columns: correct, aggfunc: { rt: mean }, dtype: { rt: float } }'),
      [],
    ],
    ['a {placeholder} is filled in at run time', study('{ index: "{grouping}" }'), []],
    ['data no schema is bound to', study('{ index: participant }', { bound: false }), []],
    ['a LinkML schema', study('{ values: [correct, response_time] }', { body: LINKML }), [UNDEFINED('response_time')]],
    ['the JSON the schema editor writes', study('{ values: [correct, response_time] }', { body: JSON_BODY }), [UNDEFINED('response_time')]],
  ];
  for (const [label, yaml, issues] of CASES) {
    const found = checkDataContract(studyflowToDefinitions(yaml, freshModdle()));
    expect(found.map((issue) => `${issue.elementId}: ${issue.message}`), label).toEqual(issues);
    expect(found.every((issue) => issue.severity === 'error'), label).toBe(true);
  }
});
