import { expect, test } from '@playwright/test';

import { parseSkillManifest } from '@core/notation/skill';

const BROWSER = `---
name: browser
description: "The participant-facing runtime."
metadata:
  runtimes:
    local: "uv run --script local.py"
---
Body.
`;

/** The browser runtime bundles from its own skill folder, so it meets its manifest as \`/SKILL.md\`, with no folder to check. */
test('a manifest parses without a folder, and is checked against one when given', () => {
  expect(parseSkillManifest(BROWSER).name).toBe('browser');
  expect(parseSkillManifest(BROWSER, 'browser').runtimes).toEqual({ local: 'uv run --script local.py' });
  expect(() => parseSkillManifest(BROWSER, 'reachy')).toThrow(/names itself "browser"/);
  expect(() => parseSkillManifest(BROWSER.replace('name: browser', 'name: Browser'))).toThrow(/lowercase/);
});
