import { expect, test } from '@playwright/test';

import { StudyflowElement } from '@core/element';
import { freshModdle } from '@tests/schemas';

/** Where an attribute lives (skills/SCHEMAS.md, "Attribute precedence"): the element, its extension wrapper, or a body inside. */

const moddle = freshModdle();

test('an attribute is read and written where it lives, and a read takes the value that wins', () => {
  const wrapperOf = (bo: any) => bo.extensionElements.values[0];
  const CASES: {
    label: string;
    type: string;
    /** On the element before its wrapper arrives, as a file holds it. */
    stored?: Record<string, unknown>;
    wrapper?: string;
    writes?: [name: string, value: unknown][];
    reads: Record<string, unknown>;
    /** Where the last write must land. */
    holder?: (bo: any) => unknown;
  }[] = [
    {
      label: 'a BPMN attribute, on the element', type: 'bpmn:Task',
      writes: [['bpmn:name', 'renamed']], reads: { 'bpmn:name': 'renamed' }, holder: (bo) => bo.name,
    },
    {
      label: 'a wrapper attribute, on the wrapper', type: 'bpmn:Task', wrapper: 'cognitive:CognitiveTask',
      writes: [['platform', 'jsPsych']], reads: { platform: 'jsPsych' }, holder: (bo) => wrapperOf(bo).platform,
    },
    {
      label: 'a body-wrapped attribute, read as its body', type: 'bpmn:SequenceFlow',
      writes: [['conditionExpression', 'score > 1']], reads: { conditionExpression: 'score > 1' }, holder: (bo) => bo.conditionExpression.body,
    },
    {
      label: 'the checklist, a documentation entry that rewriting the prose leaves alone', type: 'bpmn:Task',
      writes: [['documentation', 'Prose.'], ['checklist', '- [x] consent approved'], ['documentation', 'New prose.']],
      reads: { documentation: 'New prose.', checklist: '- [x] consent approved' },
    },
    {
      label: 'the prose, a documentation entry that writing and clearing the checklist leaves alone', type: 'bpmn:Task',
      writes: [['documentation', 'Prose.'], ['checklist', '- [ ] only item'], ['checklist', '']],
      reads: { documentation: 'Prose.', checklist: undefined },
    },
    {
      // A wrapper is no BPMN element: a trait on the element's type is the element's alone.
      label: 'a trait attribute, on the element, its wrapper beside it', type: 'bpmn:Process', wrapper: 'studyflow:Study',
      writes: [['tags', ['pilot']]], reads: { tags: ['pilot'] }, holder: (bo) => bo.tags,
    },
    {
      label: 'a redefinition among wrappers, on the wrapper under the name it redefines', type: 'bpmn:ChoreographyTask',
      wrapper: 'behaverse:Task', writes: [['instrument', 'NB']], reads: { instrument: 'NB', platform: 'behaverse' },
      holder: (bo) => wrapperOf(bo).instrument,
    },
    {
      label: 'the file\'s isExecutable, the process\'s own', type: 'bpmn:Process', stored: { isExecutable: false },
      wrapper: 'studyflow:Study', reads: { isExecutable: false },
    },
  ];
  for (const { label, type, stored, wrapper, writes = [], reads, holder } of CASES) {
    const bo = moddle.create(type, { id: 'El', ...stored });
    const element = StudyflowElement.fromBusinessObject(bo);
    if (wrapper) element.ensureExtension(wrapper, moddle, {});
    for (const [name, value] of writes) element.setAttribute(name, value);
    for (const [name, value] of Object.entries(reads)) expect(element.getAttribute(name), `${label}: ${name}`).toEqual(value);
    if (holder) expect(holder(bo), `${label}: where it lands`).toEqual(writes.at(-1)?.[1]);
  }
});
