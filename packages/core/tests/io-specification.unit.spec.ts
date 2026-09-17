import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { fromWireXml, studyflowToXml, toStandardBpmnXml, xmlToStudyflow } from '@core/document';
import { freshModdle } from '@tests/schemas';
import { exampleNames, exampleText } from '@tests/utils';

/** Exported `.bpmn` carries the full `ioSpecification`; reading it back folds it into the data associations. */

/** Draws its data associations in core types alone. */
const STATE_PROPERTIES_FIXTURE = path.join(process.cwd(), 'packages/core/tests/fixtures/state-properties.studyflow.yaml');

/** The compact form the canvas edits: what the `.bpmn` export lowers. */
async function canvasForm(text: string): Promise<string> {
  return fromWireXml(await studyflowToXml(text, freshModdle()), freshModdle());
}

/** The activity of that id, as moddle reads the XML: the structure, not the serializer's spelling of it. */
async function activityOf(xml: string, id: string): Promise<any> {
  const { rootElement } = await freshModdle().fromXML(xml);
  const walk = (containers: any[]): any[] => containers.flatMap((c) => [c, ...walk(c.flowElements ?? [])]);
  return walk(rootElement.rootElements).find((el: any) => el.id === id);
}

test.describe('standard-BPMN ioSpecification boundary', () => {
  test('the canvas form, lowered to standard BPMN, folds back to the shipped YAML', async () => {
    const fixture = readFileSync(STATE_PROPERTIES_FIXTURE, 'utf8');

    // What another BPMN tool reads: a data input per bound source, named after it, and `result` for the output.
    const compact = await canvasForm(fixture);
    expect(compact).not.toContain('ioSpecification');
    const standard = await toStandardBpmnXml(compact, freshModdle());
    const activity = await activityOf(standard, 'Run_Trial');
    const io = activity.ioSpecification;
    expect(io.dataInputs.map((input: any) => input.name)).toEqual(['arm']);
    expect(io.dataOutputs.map((output: any) => output.name)).toEqual(['result']);
    expect(io.inputSets[0].dataInputRefs).toEqual(io.dataInputs);
    expect(io.outputSets[0].dataOutputRefs).toEqual(io.dataOutputs);
    expect(activity.dataInputAssociations.map((assoc: any) => assoc.targetRef)).toEqual(io.dataInputs);
    expect(activity.dataOutputAssociations.map((assoc: any) => assoc.sourceRef[0])).toEqual(io.dataOutputs);

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
    // An unnamed source still gets a data input, named for what it is.
    expect((await activityOf(standard, 'Step')).ioSpecification.dataInputs.map((input: any) => input.name)).toEqual(['input']);
    expect(standard).not.toContain('transformation');

    const folded = await fromWireXml(standard, freshModdle());
    expect(folded).not.toContain('transformation');
    expect(folded).not.toContain('ioSpecification');

    const relowered = await toStandardBpmnXml(folded, freshModdle());
    expect(relowered).toBe(standard);
  });
});
