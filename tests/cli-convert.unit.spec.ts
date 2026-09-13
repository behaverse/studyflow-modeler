import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/** `studyflow convert` drops what no loaded schema declares, but says so: 18b2771 silently lost five datasets. */

test('convert warns about what reading drops; with --strict it writes nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studyflow-convert-'));
  // The CLI reads its schemas through Vite (`import.meta.glob`), so it is built here rather than imported.
  execFileSync(process.execPath, [path.join(process.cwd(), 'node_modules/vite/bin/vite.js'), 'build', 'packages/cli', '--outDir', path.join(dir, 'bin'), '--logLevel', 'error']);
  const convert = (...args: string[]) => spawnSync(process.execPath, [path.join(dir, 'bin', 'studyflow.mjs'), 'convert', ...args], { encoding: 'utf8' });

  // What those examples still named: `behaverse:Dataset`, since renamed `BDMDataset`.
  const old = path.join(dir, 'old.bpmn');
  writeFileSync(old, `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:behaverse="http://behaverse.org/schemas/studyflow/behaverse" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P">
    <bpmn:dataStoreReference id="Trials" name="Trials">
      <bpmn:extensionElements>
        <behaverse:dataset dataLevel="trials" />
      </bpmn:extensionElements>
    </bpmn:dataStoreReference>
  </bpmn:process>
</bpmn:definitions>
`);

  const yaml = path.join(dir, 'old.studyflow.yaml');
  const lax = convert(old, yaml);
  expect(lax.stderr).toContain('warning: unparsable content <behaverse:dataset>');
  expect(lax.stderr).toContain('unknown type <behaverse:Dataset>');
  expect(lax.status).toBe(0);
  expect(existsSync(yaml)).toBe(true);

  const strictYaml = path.join(dir, 'strict.studyflow.yaml');
  const strict = convert(old, strictYaml, '--strict');
  expect(strict.stderr).toContain('warning: unparsable content <behaverse:dataset>');
  expect(strict.status).toBe(1);
  expect(existsSync(strictYaml)).toBe(false);
});
