import { expect, test } from '@playwright/test';

import { StudyflowElement } from '@core/element';
import { extensionValueWins } from '@core/element/handle';
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
      writes: [['instrument', 'jsPsych']], reads: { instrument: 'jsPsych' }, holder: (bo) => wrapperOf(bo).instrument,
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
      // The wrapper sees the element's trait attributes too, with moddle's own `[]` for a list.
      label: 'a value the element stores, over its wrapper declaring the attribute too', type: 'bpmn:Process',
      stored: { tags: ['pilot'] }, wrapper: 'studyflow:Study', reads: { tags: ['pilot'] },
    },
    {
      label: 'a pinned wrapper default, over a stale value on the element', type: 'bpmn:Process',
      stored: { isExecutable: false }, wrapper: 'studyflow:Study', reads: { isExecutable: true },
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

test('extensionValueWins: when the wrapper, not the element, holds the value a read returns', () => {
  const spec = (over: Record<string, any> = {}) => ({
    name: 'thing',
    ns: { name: 'studyflow:thing', prefix: 'studyflow', localName: 'thing' },
    type: 'String',
    ...over,
  }) as any;
  /** moddle materializes a default on the prototype: there, but not stored. */
  const defaulted = (value: string) => Object.create({ thing: value });

  const CASES: { label: string; extDef?: any; ext: any; bo: any; name?: string; wins: boolean }[] = [
    { label: 'a pinned redefinition wins, its default even over a value the element stores', extDef: spec({ meta: { pinned: true } }), ext: defaulted('pinned default'), bo: { thing: 'from bo' }, wins: true },
    { label: 'a value the wrapper stores wins over one the element stores', extDef: spec(), ext: { thing: 'from wrapper' }, bo: { thing: 'from bo' }, wins: true },
    { label: 'a value the element stores beats a wrapper default', extDef: spec(), ext: defaulted('materialized default'), bo: { thing: 'from bo' }, wins: false },
    { label: 'a wrapper default wins when the element stores nothing either', extDef: spec(), ext: defaulted('redefined default'), bo: {}, wins: true },
    { label: 'the [] moddle initializes an isMany property to is not a stored value', extDef: spec({ isMany: true }), ext: { things: [] }, bo: { things: ['from bo'] }, name: 'things', wins: false },
    { label: 'no wrapper definition means the element, always', ext: { thing: 'x' }, bo: {}, wins: false },
  ];
  for (const { label, extDef, ext, bo, name = 'thing', wins } of CASES) {
    expect(extensionValueWins(extDef, ext, name, bo, name), label).toBe(wins);
  }
});
