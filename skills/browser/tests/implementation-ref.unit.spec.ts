import { expect, test } from '@playwright/test';

import { validateImplementations } from '@runner/nodes/implementationRef';
import { Studyflow } from '@runner/studyflow';
import { freshPackages } from '@tests/schemas';

/** What the browser runner checks, before a run starts, of the functions a study's steps call. */

test('a malformed implementation reference fails validation before the run starts', async () => {
  const study = await Studyflow.parse(`id: bad_ref
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: bpmn:Process
  flowElements:
    Bad:
      type: bpmn:ServiceTask
      name: Broken reference
      implementation: python:/oops
`, freshPackages());

  // No `severity`: an error, which keeps the run from starting (a warning would let it proceed).
  expect(validateImplementations(study)).toEqual([
    { nodeId: 'Bad', message: expect.stringContaining('The implementation reference cannot be read') },
  ]);
});
