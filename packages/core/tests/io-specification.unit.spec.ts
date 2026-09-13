import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { fromWireXml, studyflowToXml, toStandardBpmnXml, xmlToStudyflow } from '@core/document';
import { freshModdle } from '@tests/schemas';
import { exampleNames, exampleText } from '@tests/utils';

/** Exported `.bpmn` carries the full `ioSpecification`; reading it back folds it into the data associations. */

/** Draws its data associations in core types alone. */
const STATE_PROPERTIES_FIXTURE = path.join(process.cwd(), 'tests/fixtures/state-properties.studyflow');

/** The compact form the canvas edits: what the `.bpmn` export lowers. */
async function canvasForm(text: string): Promise<string> {
  return fromWireXml(await studyflowToXml(text, freshModdle()), freshModdle());
}

test.describe('standard-BPMN ioSpecification boundary', () => {
  test('the canvas form, lowered to standard BPMN, folds back to the shipped YAML', async () => {
    const fixture = readFileSync(STATE_PROPERTIES_FIXTURE, 'utf8');

    // What another BPMN tool reads: a data input per bound source, named after it, and `result` for the output.
    const compact = await canvasForm(fixture);
    expect(compact).not.toContain('ioSpecification');
    const standard = await toStandardBpmnXml(compact, freshModdle());
    for (const line of [
      '<bpmn:ioSpecification id="Run_Trial_io">',
      '<bpmn:dataInput id="Run_Trial_in_arm" name="arm" />',
      '<bpmn:dataOutput id="Run_Trial_result" name="result" />',
      '<bpmn:dataInputRefs>Run_Trial_in_arm</bpmn:dataInputRefs>',
      '<bpmn:dataOutputRefs>Run_Trial_result</bpmn:dataOutputRefs>',
      '<bpmn:targetRef>Run_Trial_in_arm</bpmn:targetRef>',
      '<bpmn:sourceRef>Run_Trial_result</bpmn:sourceRef>',
    ]) {
      expect(standard).toContain(line);
    }

    const CASES = [
      ...exampleNames.map((name): [string, string] => [name, exampleText(name)]),
      ['the state-properties fixture', fixture] as [string, string],
    ].filter(([, text]) => /data(Input|Output)Associations:/.test(text));
    for (const [name, text] of CASES) {
      const lowered = await toStandardBpmnXml(await canvasForm(text), freshModdle());
      expect(await xmlToStudyflow(lowered, freshModdle()), name).toBe(text);
    }
  });

  test('an association that sources from nothing survives lower -> fold unchanged', async () => {
    const compact = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="phantom_binding" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:task id="Step" name="Step">
      <bpmn:dataInputAssociation id="DIA_1" />
    </bpmn:task>
  </bpmn:process>
</bpmn:definitions>`;

    const standard = await toStandardBpmnXml(compact, freshModdle());
    expect(standard).toContain('<bpmn:dataInput id="Step_in_input" name="input" />');
    expect(standard).not.toContain('transformation');

    const folded = await fromWireXml(standard, freshModdle());
    expect(folded).not.toContain('transformation');
    expect(folded).not.toContain('ioSpecification');

    const relowered = await toStandardBpmnXml(folded, freshModdle());
    expect(relowered).toBe(standard);
  });
});
