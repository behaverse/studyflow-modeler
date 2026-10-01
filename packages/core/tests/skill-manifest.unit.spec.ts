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
  expect(() => parseSkillManifest(BROWSER, 'reachy')).toThrow(/browser/);
  expect(() => parseSkillManifest(BROWSER.replace('name: browser', 'name: Browser'))).toThrow(/Browser/);
});

test('a skill may ship several schemas, each with a prefix of its own', () => {
  const manifest = (schema: string) => parseSkillManifest(`---\nname: studyflow\ndescription: "The core."\nmetadata:\n  schema: "${schema}"\n---\n`);
  expect(manifest('studyflow.moddle.yaml, prov.moddle.yaml').schemas).toEqual(['studyflow.moddle.yaml', 'prov.moddle.yaml']);
  expect(manifest('studyflow.moddle.yaml').schemas).toEqual(['studyflow.moddle.yaml']);
  expect(parseSkillManifest(BROWSER).schemas).toEqual([]);
});
