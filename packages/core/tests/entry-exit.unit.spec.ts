import { expect, test } from '@playwright/test';

import { checkEntryExit } from '@core/checks/entry-exit';
import { studyModel } from '@tests/schemas';

/** What a participant meets on the way in and is handed on the way out is refused before any run when a page could
 * not fetch the consent form, or the code promised would be blank. */

const study = (start: string, end: string): string => `id: entry
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    In:
      type: StartEvent
${start}
    Out:
      type: EndEvent
${end}
    F: In -> Out
`;

test('a consent form a page can fetch, and the completion code an end event promises', () => {
  const CASES: [string, string, string, string[]][] = [
    ['an address, and a code made up per participant', '      consentFormUri: https://example.org/consent.md', '      redirectTo: https://example.org/done?cc={COMPLETION_CODE}\n      completionCodeType: dynamic', []],
    ['a path from the site\'s root, and a fixed code', '      consentFormUri: /consent.md', '      completionCodeType: static\n      completionCode: C0DE', []],
    ['a placeholder, read at run time, and no code', '      consentFormUri: "{consent}"', '      redirectTo: https://example.org/done', []],
    ['a path a page cannot resolve', '      consentFormUri: consent.md', '', ['In: "In" links the consent form "consent.md", which is neither a URL nor an absolute path: set consentFormUri to an https:// address or a path starting with "/"']],
    ['a fixed code left empty', '', '      completionCodeType: static', ['Out: "Out" has completionCodeType: static and no completionCode, so participants would get no code: type the code in completionCode, or switch completionCodeType to dynamic']],
    ['a redirect carrying a code none is made for', '', '      redirectTo: https://example.org/done?cc={COMPLETION_CODE}', ['Out: "Out" redirects to a link carrying {COMPLETION_CODE} with completionCodeType: none, so the link would carry a blank code: set completionCodeType to static or dynamic, or drop the placeholder']],
  ];
  for (const [label, start, end, says] of CASES) {
    const issues = checkEntryExit(studyModel(study(start, end)));
    expect(issues.map((issue) => `${issue.elementId}: ${issue.message}`), label).toEqual(says);
    issues.forEach((issue) => expect(issue.severity, label).toBe('error'));
  }
});
