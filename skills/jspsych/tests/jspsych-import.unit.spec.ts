import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import jspsych from '@skills/jspsych/modeler';
import { parseImplementationRef } from '@core/implementation';
import type { Element, StudyModel } from '@core/model/index';
import { freshMetamodel, studyModel } from '@tests/schemas';

/** jsPsych -> Studyflow: what the modeler's "Open" makes of a timeline file, through the skill's opener. */

const FLANKER = JSON.parse(readFileSync(path.join(process.cwd(), 'skills/jspsych/tests/fixtures/flanker.timeline.json'), 'utf8'));

/** Opens `text` as "Open" does, keeping what the opener warned about. */
function open(text: string): { model: StudyModel; warnings: string[] } {
  const warnings: string[] = [];
  const yaml = jspsych.opens[0].toStudyflow(text, { name: 'Flanker demo', metamodel: freshMetamodel(), warn: (message: string) => warnings.push(message) });
  return { model: studyModel(yaml, (message) => warnings.push(message)), warnings };
}

/** The process `model` opened as. */
const processOf = (model: StudyModel): Element => model.study.roots.find((root) => model.isA(root, 'bpmn:Process'))!;
const listOf = (element: Element, key: string): Element[] => (element[key] as Element[] | undefined) ?? [];

test('opens a timeline as a study that chains start -> tasks -> end, a cognitive task per trial', () => {
  // A trial whose stimulus is markup and escapes, text the XML must carry as written.
  const escapes = { type: 'html-keyboard-response', name: 'Escapes', stimulus: '<p>&lt; L &amp; R <<<<< </p>' };
  const { model, warnings } = open(JSON.stringify([...FLANKER, escapes]));
  expect(warnings).toEqual([]);

  const process = processOf(model);
  const flowElements = listOf(process, 'flowElements');
  const chain: Element[] = [];
  for (let node = flowElements.find((element) => element.type === 'bpmn:StartEvent'); node;) {
    chain.push(node);
    const next = flowElements.find((element) => element.type === 'bpmn:SequenceFlow' && element.sourceRef === node!.id)?.targetRef;
    node = typeof next === 'string' ? model.get(next) : undefined;
  }

  // The leading consent node is the start event's consent link, not a task.
  expect(chain.map((node) => node.name)).toEqual(['Start', 'Instructions', 'Fixation', 'Flanker test', 'Debrief', 'Escapes', 'End']);
  expect(chain[0].consentFormUri).toBe('https://example.org/protocols/flanker/consent.md');

  // Each trial is a cognitive task: platform jspsych, a versioned `jspsych://` implementation, and a Parameters
  // object wired into it holding the trial's parameters bar `type`.
  const trials = [...FLANKER.slice(1), escapes];
  const wires: Element[] = [];
  for (const [i, task] of chain.slice(1, -1).entries()) {
    const ref = parseImplementationRef(String(task.implementation));
    expect(ref.ok && [ref.value.scheme, ref.value.version], String(task.name)).toEqual(['jspsych', '8']);
    expect([model.extensionType(task), model.attribute(task, 'platform')], String(task.name)).toEqual(['cognitive:CognitiveTask', 'jspsych']);
    const [wire] = listOf(task, 'dataInputAssociations');
    wires.push(wire);
    const holder = model.get((wire.sourceRef as string[])[0])!;
    expect(holder.type, String(task.name)).toBe('studyflow:Parameters');
    const { type: _type, ...parameters } = trials[i];
    expect(holder.values, String(task.name)).toEqual(parameters);
  }

  // Laid out: every node, flow and wire has its shape or edge.
  expect(Object.keys(model.study.layout).sort()).toEqual([...flowElements, ...wires].map((element) => element.id).sort());
});

test('a consent screen that links no form links one from the site\'s root, which a page can fetch, and says so', () => {
  const { consent_url: _url, ...consent } = FLANKER[0];
  const { model, warnings } = open(JSON.stringify([consent, ...FLANKER.slice(1)]));
  const start = listOf(processOf(model), 'flowElements').find((element) => element.type === 'bpmn:StartEvent')!;
  expect(start.consentFormUri).toBe('/consent.md');
  expect(warnings).toEqual([expect.stringContaining('Point consentFormUri at your form')]);
});

/** The ids of the tasks the opened study holds. */
function taskIds(text: string): string[] {
  const { model } = open(text);
  return listOf(processOf(model), 'flowElements').filter((element) => /Task$/.test(model.host(element))).map((element) => element.id!);
}

test('opens a timeline array or an experiment object holding one, and rejects JSON that is neither', () => {
  const CASES: [string, RegExp | undefined][] = [
    [JSON.stringify({ timeline: FLANKER }), undefined],
    ['{ not json', /JSON/],
    ['[1, 2, 3]', /timeline/i],
    ['[]', /timeline/i],
    ['[[{"type": "x"}]]', /timeline/i],
    ['{"timeline": ["a"]}', /timeline/i],
    ['{"name": "package.json", "version": "1.0.0"}', /timeline/i],
  ];

  for (const [text, error] of CASES) {
    if (error) expect(() => open(text), text).toThrow(error);
    else expect(taskIds(text), text).toContain('Flanker_test');
  }
});
