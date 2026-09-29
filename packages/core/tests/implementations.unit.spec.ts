import { expect, test } from '@playwright/test';

import { studyflowToDefinitions } from '@core/document';
import { checkImplementations } from '@core/checks/implementations';
import { freshModdle } from '@tests/schemas';

/** An implementation no loaded skill runs is reported before a run: a scheme the skills declare passes. */
test('an implementation names a scheme some loaded skill declares', () => {
  const definitions = studyflowToDefinitions(`id: schemes
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  flowElements:
    Fit:
      type: ServiceTask
      implementation: python://sklearn.svm.SVC
    Wrap:
      type: ServiceTask
      implementation: docker://nipreps/fmriprep:23.2.0
    Bare:
      type: ServiceTask
      implementation: random
`, freshModdle());
  const messages = checkImplementations(definitions, new Set(['python'])).map((issue) => `${issue.severity} ${issue.elementId}`);
  expect(messages).toEqual(['warning Wrap', 'warning Bare']);
});
