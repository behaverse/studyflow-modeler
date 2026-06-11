import { expect, test } from '@playwright/test';

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
    await runPaletteCommand(page, 'Export As...', 'SVG...');
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
    await runPaletteCommand(page, 'Save As...');
    const studyflowDownload = await studyflowDownloadPromise;
    const studyflowText = await readDownloadText(studyflowDownload);

    expect(studyflowDownload.suggestedFilename()).toBe('diagram.studyflow');
    expect(normalizeXml(studyflowText)).toBe(normalizedEmbeddedStudyflow);
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
    await runPaletteCommand(page, 'Export As...', 'SVG...');
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
    await runPaletteCommand(page, 'Save As...');
    const studyflowDownload = await studyflowDownloadPromise;
    const studyflowText = await readDownloadText(studyflowDownload);
    const normalizedStudyflow = normalizeXml(studyflowText);

    expect(normalizedStudyflow).toContain('<omniprocess:map/>');
    expect(normalizedStudyflow).toBe(normalizedEmbeddedStudyflow);
  });

  test('applies default schema values for omniprocess EEGPrep elements', async ({ page }) => {
    await gotoModeler(page);

    await addSchemaPaletteElement(page, 'OmniProcess', 'EEGPrep', { x: 260, y: 200 });

    const studyflowDownloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...');
    const studyflowDownload = await studyflowDownloadPromise;
    const normalizedStudyflow = normalizeXml(await readDownloadText(studyflowDownload));

    // The EEGPrep template now expands into a subprocess pipeline
    // (filter signal -> remove artifacts) of data-operation service tasks.
    expect(normalizedStudyflow).toContain('<omniprocess:preprocessEEG ');
    expect(normalizedStudyflow).toMatch(/<[A-Za-z0-9_]+:subProcess\b/);
    expect(normalizedStudyflow).toContain('studyflow:isDataOperation="true"');
    expect(normalizedStudyflow).toContain('<omniprocess:filter ');
    expect(normalizedStudyflow).toContain('name="EEGPrep"');
  });
});