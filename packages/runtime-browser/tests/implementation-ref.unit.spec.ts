import { expect, test } from '@playwright/test';

import { validateImplementations } from '@runner/nodes/implementationRef';
import { Studyflow } from '@runner/studyflow';
import { freshPackages } from '@tests/schemas';

/** What the browser runner checks, before a run starts, of the functions a study's steps call. */

test('a malformed implementation reference fails validation before the run starts; a well-formed one raises nothing, whatever its scheme', async () => {
  const study = (implementation: string) => Studyflow.parse(`id: refs
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: bpmn:Process
  flowElements:
    Step:
      type: bpmn:ServiceTask
      implementation: ${implementation}
`, freshPackages());

  // No `severity`: an error, which keeps the run from starting (a warning would let it proceed).
  expect(validateImplementations(await study('python:/oops'))).toEqual([
    { nodeId: 'Step', message: expect.stringMatching(/implementation/i) },
  ]);
  // The runner that claims a scheme is found at run time, so no scheme is unknown here.
  expect(validateImplementations(await study('shell://say'))).toEqual([]);
});
