import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { xmlToStudyflow } from '../src/lib/core/studyflowYaml';
import { SCHEMAS } from '../src/lib/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/lib/core/schema';
import {
  addPaletteElement,
  addSchemaPaletteElement,
  extractStudyflowFromSvg,
  gotoModeler,
  normalizeXml,
  readDownloadText,
  runPaletteCommand,
  setSelectedElementName,
} from './utils';

/** Convert BPMN XML to studyflow YAML the same way the app does. */
async function toYaml(xml: string): Promise<string> {
  const schemaDir = path.join(process.cwd(), 'src/assets/schemas');
  const models = SCHEMAS.map(({ prefix }) =>
    fromModdleYaml(readFileSync(path.join(schemaDir, `${prefix}.moddle.yaml`), 'utf8')),
  );
  const packages = Object.fromEntries(models.map((m) => [m.prefix, toModdlePackages(m, models)]));
  return xmlToStudyflow(xml, new BpmnModdle(packages));
}

test.describe('Studyflow modeler palette flows', () => {
  test('adds palette items, names a task, and keeps exported outputs in sync', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Events', 'Start', { x: 140, y: 160 });
    await expect(page.getByTestId('inspector-root')).toContainText('StartEvent');

    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await expect(page.getByTestId('inspector-root')).toContainText('Task');

    await setSelectedElementName(page, 'Review Task');
    await expect(page.getByTestId('modeler-canvas')).toContainText('Review Task');

    await page.route('https://api.iconify.design/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>',
      });
    });

    const svgDownloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...', 'SVG...');
    const svgDownload = await svgDownloadPromise;
    const svgText = await readDownloadText(svgDownload);

    expect(svgDownload.suggestedFilename()).toBe('diagram.svg');
    expect(svgText).toContain('Review Task');
    expect(svgText).toContain('<studyflow>');

    const embeddedStudyflow = extractStudyflowFromSvg(svgText);
    const normalizedEmbeddedStudyflow = normalizeXml(embeddedStudyflow);
    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:task\b/);
    expect(normalizedEmbeddedStudyflow).toContain('name="Review Task"');
    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:startEvent\b/);

    const studyflowDownloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...', 'Studyflow...');
    const studyflowDownload = await studyflowDownloadPromise;
    const studyflowText = await readDownloadText(studyflowDownload);

    expect(studyflowDownload.suggestedFilename()).toBe('diagram.studyflow');
    expect(studyflowText.startsWith('id:')).toBe(true);
    expect(studyflowText).toContain('name: Review Task');
    // The saved YAML and the SVG-embedded XML describe the same diagram.
    expect(studyflowText).toBe(await toYaml(embeddedStudyflow));
  });

  test('adds a schema-backed omniprocess element and preserves operation defaults', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Events', 'Start', { x: 120, y: 160 });
    await addSchemaPaletteElement(page, 'OmniProcess', 'Map', { x: 320, y: 180 });

    await page.route('https://api.iconify.design/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>',
      });
    });

    const svgDownloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...', 'SVG...');
    const svgDownload = await svgDownloadPromise;
    const embeddedStudyflow = extractStudyflowFromSvg(await readDownloadText(svgDownload));
    const normalizedEmbeddedStudyflow = normalizeXml(embeddedStudyflow);

    // Map is a service task; its operation defaults (isDataOperation,
    // operationType="map") stay implicit in the schema rather than being
    // serialized onto the element.
    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:serviceTask\b/);
    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:startEvent\b/);
    expect(normalizedEmbeddedStudyflow).toContain('<omniprocess:map/>');

    const studyflowDownloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...', 'Studyflow...');
    const studyflowDownload = await studyflowDownloadPromise;
    const studyflowText = await readDownloadText(studyflowDownload);

    // In YAML the wrapper stays bare; the pinned operation defaults live as
    // explicit values on the service task element.
    expect(studyflowText).toContain('type: omniprocess:Map');
    expect(studyflowText).toContain('isDataOperation: true');
    expect(studyflowText).toContain('operationType: map');
    expect(studyflowText).toBe(await toYaml(embeddedStudyflow));
  });

  test('adds a template-backed omniprocess operation with its function reference', async ({ page }) => {
    await gotoModeler(page);

    // Group is a template (a Map bound to a grouping function), not a type.
    await addSchemaPaletteElement(page, 'OmniProcess', 'Group', { x: 320, y: 180 });

    const studyflowDownloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...', 'Studyflow...');
    const studyflowDownload = await studyflowDownloadPromise;
    const studyflowText = await readDownloadText(studyflowDownload);

    expect(studyflowText).toContain('type: omniprocess:Map');
    expect(studyflowText).toContain('name: Group');
    expect(studyflowText).toContain('operationType: group');
    expect(studyflowText).toContain('uses: python://omniprocess.group');
    expect(studyflowText).toContain('key: participant');
  });

  test('applies default schema values for omniprocess EEGPrep elements', async ({ page }) => {
    await gotoModeler(page);

    await addSchemaPaletteElement(page, 'OmniProcess', 'EEGPrep', { x: 260, y: 200 });

    const studyflowDownloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...', 'Studyflow...');
    const studyflowDownload = await studyflowDownloadPromise;
    const studyflowText = await readDownloadText(studyflowDownload);

    // The EEGPrep template now expands into a subprocess pipeline
    // (filter signal -> remove artifacts) of data-operation service tasks.
    expect(studyflowText).toContain('type: omniprocess:PreprocessEEG');
    expect(studyflowText).toContain('type: bpmn:SubProcess');
    expect(studyflowText).toContain('isDataOperation: true');
    expect(studyflowText).toContain('type: omniprocess:Filter');
    expect(studyflowText).toContain('name: EEGPrep');
  });
});