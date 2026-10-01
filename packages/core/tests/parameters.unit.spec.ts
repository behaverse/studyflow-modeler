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
        - type: cognitive:Rest
          restDuration: 60
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
            restDuration: 30
            beep: true
    Eyes:
      type: DataObjectReference
      extensionElements:
        - type: studyflow:Parameters
          values:
            eyes: closed
            restDuration: 45
    Knobs:
      type: DataObjectReference
      extensionElements:
        - type: studyflow:Parameters
          values:
            seed: 7
            eyes: open
`;

test('a key naming one of a step\'s own attributes sets it, any other key is its configuration, and an unwired object sets nothing', () => {
  const model = studyModel(STUDY);
  const [process, pause] = [model.get('Overrides')!, model.get('Pause')!];

  const overrides = attributeOverridesIn(model, pause);
  expect([...overrides.keys()].sort(), 'beep is no attribute of a Rest').toEqual(['eyes', 'restDuration']);
  expect(overrides.get('eyes')?.value).toBe('closed');
  // Two objects setting one attribute: both are named, and a run refuses it.
  expect(overrides.get('restDuration')?.sources.map((source) => source.id).sort()).toEqual(['Eyes', 'Timing']);
  // Knobs is wired into nothing: its `seed` leaves the Study's alone, its `eyes` the Rest's.
  expect(attributeOverridesIn(model, process).size).toBe(0);
  expect(model.attribute(process, 'seed')).toBe(3);

  expect(splitIn(model, pause, { eyes: 'open', beep: true })).toEqual({ attributes: { eyes: 'open' }, rest: { beep: true } });
  expect(() => splitIn(model, pause, { restDuration: { seconds: 30 } }))
    .toThrow(/Pause.*restDuration.*mapping/);
});
