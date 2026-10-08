import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { extractStudyflowFromPng, extractStudyflowFromSvg } from '@core/document';

/** `studyflow convert`, between the formats a study is spelled in. */

/** The CLI, built once per worker: it reads its schemas through Vite (`import.meta.glob`), so it is built rather than
 * imported. */
let bin: string | undefined;
function convert(...args: string[]) {
  if (!bin) {
    const out = mkdtempSync(path.join(tmpdir(), 'studyflow-cli-'));
    execFileSync(process.execPath, [path.join(process.cwd(), 'node_modules/vite/bin/vite.js'), 'build', 'packages/cli', '--outDir', out, '--logLevel', 'error'], { stdio: 'pipe' });
    bin = path.join(out, 'studyflow.mjs');
  }
  return spawnSync(process.execPath, [bin, 'convert', ...args], { encoding: 'utf8' });
}

/** It drops what no loaded schema declares, but says so: 18b2771 silently lost five datasets. */
test('convert warns about what reading drops; with --strict it writes nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studyflow-convert-'));

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
  expect(lax.stderr).toMatch(/warning[^\n]*<behaverse:dataset>/i);
  expect(lax.stderr).toMatch(/behaverse:Dataset/);
  expect(lax.status).toBe(0);
  expect(existsSync(yaml)).toBe(true);

  const strictYaml = path.join(dir, 'strict.studyflow.yaml');
  const strict = convert(old, strictYaml, '--strict');
  expect(strict.stderr).toMatch(/warning[^\n]*<behaverse:dataset>/i);
  expect(strict.status).toBe(1);
  expect(existsSync(strictYaml)).toBe(false);
});

test('convert writes BPMN XML, embeds the study into the image --into names or the target already is, and refuses an image target it has no image for', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studyflow-targets-'));
  const study = path.join(dir, 'tiny.studyflow.yaml');
  writeFileSync(study, 'id: tiny\ndefinitions:\n  targetNamespace: http://bpmn.io/schema/bpmn\nP:\n  type: Process\n  flowElements:\n    Start: { type: StartEvent }\n    Done: { type: EndEvent }\n    F1: Start -> Done\n');
  const at = (name: string) => path.join(dir, name);
  // What each text target holds, which an image of its kind carries: a PNG the YAML, an SVG the XML.
  expect(convert(study, at('tiny.yaml')).status).toBe(0);
  const yaml = readFileSync(at('tiny.yaml'), 'utf8');
  const favicon = path.join(process.cwd(), 'assets/img/favicon.png');
  const figure = path.join(process.cwd(), 'docs/assets/img/diagrams/run-lifecycle.studyflow.svg');
  for (const [target, args, said] of [
    ['tiny.bpmn', [], 'Wrote $ (BPMN XML).'],
    ['tiny.studyflow.png', ['--into', favicon], `Wrote $ (embedded studyflow into ${favicon}).`],
    ['tiny.studyflow.svg', ['--into', figure], `Wrote $ (embedded studyflow into ${figure}).`],
    // Converted again, the target is the image.
    ['tiny.studyflow.svg', [], 'Wrote $ (embedded studyflow into the existing image).'],
  ] as const) {
    const done = convert(study, at(target), ...args);
    expect(done.stdout.trim(), target).toBe(said.replace('$', at(target)));
  }
  const xml = readFileSync(at('tiny.bpmn'), 'utf8');
  expect(xml).toMatch(/^<\?xml[^>]*\?>\s*<bpmn:definitions [^>]*id="tiny"/);
  expect(extractStudyflowFromPng(readFileSync(at('tiny.studyflow.png')))).toBe(yaml);
  expect(extractStudyflowFromSvg(readFileSync(at('tiny.studyflow.svg'), 'utf8'))).toBe(xml.replace(/^<\?xml[^>]*\?>\s*/, '').trim());

  const refused = convert(study, at('new.studyflow.png'));
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain('A .studyflow.png target needs an image: pass --modeler to draw one, or --into <png> to embed into an existing image.');
  expect(existsSync(at('new.studyflow.png'))).toBe(false);
});
