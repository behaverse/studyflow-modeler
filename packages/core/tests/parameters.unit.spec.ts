import { expect, test } from '@playwright/test';

import { attributeOverridesIn, splitIn } from '@core/model/parameters';
import { studyModel } from '@tests/schemas';

/** What the Parameters wired into a step set on it: a key naming one of its attributes; only a wire makes one count. */

const STUDY = `id: overrides
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Overrides:
  type: Process
  extensionElements:
    - type: studyflow:Study
      seed: 3
  flowElements:
    Pause:
      type: Task
      extensionElements:
        - type: cognitive:CognitiveTask
          construct: attention
      dataInputAssociations:
        In_Timing:
          sourceRef:
            - Timing
        In_Eyes:
          sourceRef:
            - Eyes
    Timing:
      type: DataObjectReference
      name: Timing
      extensionElements:
        - type: studyflow:Parameters
          values:
            construct: inhibition
            beep: true
    Eyes:
      type: DataObjectReference
      extensionElements:
        - type: studyflow:Parameters
          values:
            platform: psychopy
            construct: memory
    Knobs:
      type: DataObjectReference
      extensionElements:
        - type: studyflow:Parameters
          values:
            seed: 7
            platform: jspsych
`;

test('a key naming one of a step\'s own attributes sets it, any other key is its configuration, and an unwired object sets nothing', () => {
  const model = studyModel(STUDY);
  const [process, pause] = [model.get('Overrides')!, model.get('Pause')!];

  const overrides = attributeOverridesIn(model, pause);
  expect([...overrides.keys()].sort(), 'beep is no attribute of a cognitive task').toEqual(['construct', 'platform']);
  expect(overrides.get('platform')?.value).toBe('psychopy');
  // Two objects setting one attribute: both are named, and a run refuses it.
  expect(overrides.get('construct')?.sources.map((source) => source.id).sort()).toEqual(['Eyes', 'Timing']);
  // Knobs is wired into nothing: its `seed` leaves the Study's alone, its `platform` the task's.
  expect(attributeOverridesIn(model, process).size).toBe(0);
  expect(model.attribute(process, 'seed')).toBe(3);

  expect(splitIn(model, pause, { platform: 'jspsych', beep: true })).toEqual({ attributes: { platform: 'jspsych' }, rest: { beep: true } });
  expect(() => splitIn(model, pause, { construct: { name: 'inhibition' } }))
    .toThrow(/Pause.*construct.*mapping/);
});
