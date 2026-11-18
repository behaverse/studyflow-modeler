import { expect, test } from '@playwright/test';

import { Study } from '@canvas/index.ts';
import { describeChanges } from '@modeler/review/changes';

import { studyModel } from './schemas';

const BEFORE = `id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    Read:
      type: Task
      name: Read
      bounds: 200 80 100 80
    Write:
      type: Task
      name: Write
      bounds: 400 80 100 80
    Gone:
      type: Task
      name: Going
      bounds: 600 80 100 80
`;

/** A version another tool wrote: Read renamed, Write moved, Gone taken away, a task added. */
const AFTER = BEFORE
  .replace('name: Read', 'name: Read twice')
  .replace('bounds: 400 80 100 80', 'bounds: 420 80 100 80')
  .replace('    Gone:\n      type: Task\n      name: Going\n      bounds: 600 80 100 80\n', '    Fresh:\n      type: UserTask\n      bounds: 600 80 100 80\n');

test('a version under review is listed by what each change did: what came, what changed of it, and what went, by name', async () => {
  const before = Study.of(studyModel(BEFORE));
  const after = Study.of(studyModel(BEFORE));
  const ids = await after.adopt(AFTER);
  if (!ids.ok) throw new Error(ids.reason);

  expect(describeChanges(ids, before, after)).toEqual([
    // One with no name is listed by its id.
    { id: 'Fresh', kind: 'added', label: 'Fresh', type: 'UserTask', what: [] },
    { id: 'Read', kind: 'changed', label: 'Read twice', type: 'Task', what: ['name'] },
    { id: 'Write', kind: 'changed', label: 'Write', type: 'Task', what: ['drawing'] },
    // What went is named as the version before held it.
    { id: 'Gone', kind: 'removed', label: 'Going', type: 'Task', what: [] },
  ]);
});
