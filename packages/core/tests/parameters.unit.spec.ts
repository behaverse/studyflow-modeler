import { expect, test } from '@playwright/test';

import { attributeOverrides, effectiveAttribute, splitAttributes, studyflowToDefinitions } from '@core/document';
import { freshModdle } from '@tests/schemas';

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
  const definitions: any = studyflowToDefinitions(STUDY, freshModdle());
  const process = definitions.rootElements.find((root: any) => root.$type === 'bpmn:Process');
  const pause = process.flowElements.find((element: any) => element.id === 'Pause');

  const overrides = attributeOverrides(pause);
  expect([...overrides.keys()].sort(), 'beep is no attribute of a Rest').toEqual(['eyes', 'restDuration']);
  expect(effectiveAttribute(pause, 'eyes')).toBe('closed');
  // Two objects setting one attribute: both are named, and a run refuses it.
  expect(overrides.get('restDuration')?.sources.map((source) => source.id).sort()).toEqual(['Eyes', 'Timing']);
  // Knobs is wired into nothing: its `seed` leaves the Study's alone, its `eyes` the Rest's.
  expect(attributeOverrides(process).size).toBe(0);
  expect(effectiveAttribute(process, 'seed')).toBe(3);

  expect(splitAttributes(pause, { eyes: 'open', beep: true }, 'Pause')).toEqual({ attributes: { eyes: 'open' }, rest: { beep: true } });
  expect(() => splitAttributes(pause, { restDuration: { seconds: 30 } }, 'Pause'))
    .toThrow(/Pause.*restDuration.*mapping/);
});
