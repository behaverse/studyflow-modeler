import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { diagramTitle, exportDiagram, gotoModeler, readDownload, readDownloadText } from './utils';

test('opening a file says what its reading could not place', async ({ page }) => {
  await page.clock.install();
  await gotoModeler(page);

  // No schema declares `studyflow:retired`: the reader drops it, so the next save would too.
  await page.getByTestId('open-file-input').setInputFiles({
    name: 'retired.bpmn',
    mimeType: 'application/xml',
    buffer: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:studyflow="http://behaverse.org/schemas/studyflow/v1" id="Retired" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Study">
    <bpmn:startEvent id="Start">
      <bpmn:extensionElements><studyflow:retired /></bpmn:extensionElements>
    </bpmn:startEvent>
  </bpmn:process>
</bpmn:definitions>`),
  });

  await expect(page.locator('[data-element-id="Start"]')).toBeVisible();
  await expect(page.getByTestId('notices')).toContainText(/retired\.bpmn/);
  await expect(page.getByTestId('notices')).toContainText(/<studyflow:retired>/);

  // Past the time a warning clears itself: this one names what the next save drops, so it waits to be dismissed.
  await page.clock.fastForward(10_000);
  await expect(page.getByTestId('notices')).toContainText(/retired\.bpmn/);
});

test('exports YAML, PNG, SVG and a skill\'s format; opens a layout-less file, a jsPsych timeline, and the exports again', async ({ page }) => {
  await gotoModeler(page);
  const open = page.getByTestId('open-file-input');
  const title = diagramTitle(page);

  // A download is an export, so the YAML carries the trail's first stamp.
  const yaml = await exportDiagram(page, 'studyflow');
  expect(yaml.suggestedFilename()).toBe('diagram.studyflow.yaml');
  const yamlText = await readDownloadText(yaml);
  expect(yamlText).toContain('action: created');
  const png = await exportDiagram(page, 'png');
  expect(png.suggestedFilename()).toBe('diagram.studyflow.png');
  const pngBytes = await readDownload(png);
  const svgText = await readDownloadText(await exportDiagram(page, 'svg'));
  // A skill's export is one more format in Save As; the figures a manuscript takes are in its own view.
  const linkml = await exportDiagram(page, 'linkml');
  expect(linkml.suggestedFilename()).toBe('diagram.linkml.yaml');
  expect(await readDownloadText(linkml)).toContain('behaverse.org/schemas/studyflow');

  // No diagram interchange, and the canvas never lays out: import lays the file out first.
  await open.setInputFiles({
    name: 'layoutless.studyflow',
    mimeType: 'text/yaml',
    buffer: readFileSync(path.join(process.cwd(), 'tests/fixtures/layoutless.studyflow')),
  });
  await expect(title).toHaveText('Layout-less demo');
  for (const id of ['Enroll', 'Eligibility_Gateway', 'DidNotStart', 'Done']) {
    await expect(page.locator(`[data-element-id="${id}"]`), id).toBeVisible();
  }

  // A skill's opener takes a file of its own: a jsPsych timeline is converted on the way in.
  await open.setInputFiles({
    name: 'flanker.timeline.json',
    mimeType: 'application/json',
    buffer: readFileSync(path.join(process.cwd(), 'skills/jspsych/tests/fixtures/flanker.timeline.json')),
  });
  await expect(title).toHaveText('flanker.timeline');
  await expect(page.locator('[data-element-id="Flanker_test"]')).toBeVisible();

  // The exports reopen as the diagram they were made from.
  await open.setInputFiles({ name: 'as-yaml.studyflow.yaml', mimeType: 'text/yaml', buffer: Buffer.from(yamlText, 'utf8') });
  await expect(title).toHaveText('as-yaml');
  await expect(page.locator('[data-element-id="StartEvent_1"]')).toBeVisible();
  await open.setInputFiles({ name: 'as-png.studyflow.png', mimeType: 'image/png', buffer: pngBytes });
  await expect(title).toHaveText('as-png');
  await expect(page.locator('[data-element-id="StartEvent_1"]')).toBeVisible();
  await open.setInputFiles({ name: 'as-svg.studyflow.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svgText, 'utf8') });
  await expect(title).toHaveText('as-svg');
  await expect(page.locator('[data-element-id="StartEvent_1"]')).toBeVisible();
});
