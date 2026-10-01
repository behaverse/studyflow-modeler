import { expect, test } from '@playwright/test';

import { parseSkillManifest } from '@core/notation/skill';

const SHELL = `---
name: shell
description: "Shell commands as steps."
metadata:
  runtimes:
    local: "uv run --script local.py"
---
Body.
`;

/** `studyflow skill add` reads a manifest before its folder is named, so there is no folder to check yet. */
test('a manifest parses without a folder, and is checked against one when given', () => {
  expect(parseSkillManifest(SHELL).name).toBe('shell');
  expect(parseSkillManifest(SHELL, 'shell').runtimes).toEqual({ local: 'uv run --script local.py' });
  expect(() => parseSkillManifest(SHELL, 'reachy')).toThrow(/shell/);
  expect(() => parseSkillManifest(SHELL.replace('name: shell', 'name: Shell'))).toThrow(/Shell/);
});

test('a skill may ship several schemas, each with a prefix of its own', () => {
  const manifest = (schema: string) => parseSkillManifest(`---\nname: studyflow\ndescription: "The core."\nmetadata:\n  schema: "${schema}"\n---\n`);
  expect(manifest('studyflow.moddle.yaml, prov.moddle.yaml').schemas).toEqual(['studyflow.moddle.yaml', 'prov.moddle.yaml']);
  expect(manifest('studyflow.moddle.yaml').schemas).toEqual(['studyflow.moddle.yaml']);
  expect(parseSkillManifest(SHELL).schemas).toEqual([]);
});
