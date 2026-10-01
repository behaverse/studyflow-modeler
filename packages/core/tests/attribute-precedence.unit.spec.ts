import { expect, test } from '@playwright/test';

import { StudyModel, type Element } from '@core/model/index';
import { freshMetamodel } from '@tests/schemas';

/** Where an attribute lives (skills/SCHEMAS.md, "Attribute precedence"): the element, or its schema entry. */

test('an attribute is read and written where it lives, and a read takes the value that wins', () => {
  const entryOf = (element: Element) => (element.extensionElements as Element[])[0];
  const CASES: {
    label: string;
    type: string;
    /** On the element before its entry arrives, as a file holds it. */
    stored?: Record<string, unknown>;
    entry?: string;
    writes?: [name: string, value: string][];
    reads: Record<string, unknown>;
    /** Where the last write must land. */
    holder?: (element: Element) => unknown;
  }[] = [
    {
      label: 'a BPMN attribute, on the element', type: 'bpmn:Task',
      writes: [['name', 'renamed']], reads: { name: 'renamed' }, holder: (element) => element.name,
    },
    {
      label: 'an entry attribute, on the entry', type: 'bpmn:Task', entry: 'cognitive:CognitiveTask',
      writes: [['platform', 'jsPsych']], reads: { platform: 'jsPsych' }, holder: (element) => entryOf(element).platform,
    },
    {
      label: 'an expression, as its text', type: 'bpmn:SequenceFlow',
      writes: [['conditionExpression', 'score > 1']], reads: { conditionExpression: 'score > 1' }, holder: (element) => element.conditionExpression,
    },
    {
      label: 'the checklist, an attribute on the element beside the prose', type: 'bpmn:Task',
      writes: [['documentation', 'Prose.'], ['checklist', '- [x] consent approved']],
      reads: { documentation: 'Prose.', checklist: '- [x] consent approved' }, holder: (element) => element.checklist,
    },
    {
      // An entry is no BPMN element: a trait on the element's type is the element's alone.
      label: 'a trait attribute, on the element, its entry beside it', type: 'bpmn:Process', entry: 'studyflow:Study',
      writes: [['checklist', '- [ ] pilot']], reads: { checklist: '- [ ] pilot' }, holder: (element) => element.checklist,
    },
    {
      label: 'a redefinition among entries, on the entry under the name it redefines', type: 'bpmn:ChoreographyTask',
      entry: 'behaverse:Task', writes: [['instrument', 'NB']], reads: { instrument: 'NB', platform: 'behaverse' },
      holder: (element) => entryOf(element).instrument,
    },
    {
      label: 'the file\'s isExecutable, the process\'s own', type: 'bpmn:Process', stored: { isExecutable: false },
      entry: 'studyflow:Study', reads: { isExecutable: false },
    },
  ];
  for (const { label, type, stored, entry, writes = [], reads, holder } of CASES) {
    const element: Element = { ...(stored as Element), type, id: 'El', ...(entry ? { extensionElements: [{ type: entry }] } : {}) };
    const root: Element = type === 'bpmn:Process' ? element : { type: 'bpmn:Process', id: 'P', flowElements: [element] };
    const model = new StudyModel({ definitions: {}, roots: [root], layout: {} }, freshMetamodel());
    for (const [name, value] of writes) model.setAttribute(element, name, value);
    for (const [name, value] of Object.entries(reads)) expect(model.attributeOrDefault(element, name), `${label}: ${name}`).toEqual(value);
    if (holder) expect(holder(element), `${label}: where it lands`).toEqual(writes.at(-1)?.[1]);
  }
});
