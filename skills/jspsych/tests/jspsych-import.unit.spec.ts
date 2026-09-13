import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import jspsych from '@skills/jspsych/modeler';
import { parseImplementationRef } from '@core/implementation';
import { freshModdle, freshPackages } from '@tests/schemas';

/** jsPsych -> Studyflow: what the modeler's "Open" makes of a timeline file, through the skill's opener. */

const FLANKER = JSON.parse(readFileSync(path.join(process.cwd(), 'skills/jspsych/tests/fixtures/flanker.timeline.json'), 'utf8'));

/** Opens `text` as "Open" does, keeping what the opener warned about. */
async function open(text: string): Promise<{ xml: string; warnings: string[] }> {
  const warnings: string[] = [];
  const xml = await jspsych.opens[0].toXml(text, { name: 'Flanker demo', packages: freshPackages(), warn: (message) => warnings.push(message) });
  return { xml, warnings };
}

test('opens a timeline as a study that chains start -> tasks -> end, a cognitive task per trial', async () => {
  // A trial whose stimulus is markup and escapes, text the XML must carry as written.
  const escapes = { type: 'html-keyboard-response', name: 'Escapes', stimulus: '<p>&lt; L &amp; R <<<<< </p>' };
  const { xml, warnings } = await open(JSON.stringify([...FLANKER, escapes]));
  expect(warnings).toEqual([]);

  const { rootElement: definitions } = await freshModdle().fromXML(xml);
  const process = definitions.rootElements.find((element: any) => element.$type === 'bpmn:Process');
  const chain: any[] = [];
  for (let node = process.flowElements.find((element: any) => element.$type === 'bpmn:StartEvent'); node; node = node.outgoing?.[0]?.targetRef) {
    chain.push(node);
  }

  // The leading consent node is the start event's consent link, not a task.
  expect(chain.map((node) => node.name)).toEqual(['Start', 'Instructions', 'Fixation', 'Flanker test', 'Debrief', 'Escapes', 'End']);
  expect(chain[0].get('studyflow:consentFormUri')).toBe('https://example.org/protocols/flanker/consent.md');

  // Each trial is a cognitive task: instrument jspsych, a versioned `jspsych://` implementation, its parameters bar `type`.
  const trials = [...FLANKER.slice(1), escapes];
  for (const [i, task] of chain.slice(1, -1).entries()) {
    const ref = parseImplementationRef(task.implementation);
    expect(ref.ok && [ref.value.scheme, ref.value.version], task.name).toEqual(['jspsych', '8']);
    const [wrapper] = task.extensionElements.values;
    expect([wrapper.$type, wrapper.get('instrument')], task.name).toEqual(['cognitive:CognitiveTask', 'jspsych']);
    const { type: _type, ...parameters } = trials[i];
    expect(yaml.load(wrapper.get('configurations').get('value')), task.name).toEqual(parameters);
  }

  // Laid out: every node and flow has its shape or edge.
  const drawn = definitions.diagrams[0].plane.planeElement.map((di: any) => di.bpmnElement.id);
  expect(drawn.sort()).toEqual(process.flowElements.map((element: any) => element.id).sort());
});

test('opens a timeline array or an experiment object holding one, and rejects JSON that is neither', async () => {
  const CASES: [string, RegExp | undefined][] = [
    [JSON.stringify({ timeline: FLANKER }), undefined],
    ['{ not json', /not valid JSON/],
    ['[1, 2, 3]', /does not look like a jsPsych timeline/],
    ['[]', /does not look like a jsPsych timeline/],
    ['[[{"type": "x"}]]', /does not look like a jsPsych timeline/],
    ['{"timeline": ["a"]}', /does not look like a jsPsych timeline/],
    ['{"name": "package.json", "version": "1.0.0"}', /timeline array/],
  ];

  for (const [text, error] of CASES) {
    if (error) await expect(open(text), text).rejects.toThrow(error);
    else expect((await open(text)).xml, text).toContain('<bpmn:userTask id="Flanker_test"');
  }
});
