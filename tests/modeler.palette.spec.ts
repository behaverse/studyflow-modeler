import { expect, test } from '@playwright/test';

import {
  addPaletteElement,
  addSchemaPaletteElement,
  extractStudyflowFromSvg,
  gotoModeler,
  normalizeXml,
  openFileMenu,
  readDownloadText,
  setSelectedElementName,
} from './utils';

test.describe('Studyflow modeler palette flows', () => {
  test('adds palette items, names a task, and keeps exported outputs in sync', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Create Start Event', { x: 140, y: 160 });
    await expect(page.getByTestId('inspector-root')).toContainText('StartEvent');

    await addPaletteElement(page, 'Create Task', { x: 340, y: 180 });
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

    await openFileMenu(page);
    const svgDownloadPromise = page.waitForEvent('download');
    await page.getByText('Export to SVG...', { exact: true }).click();
    const svgDownload = await svgDownloadPromise;
    const svgText = await readDownloadText(svgDownload);

    expect(svgDownload.suggestedFilename()).toBe('Untitled Diagram.svg');
    expect(svgText).toContain('Review Task');
    expect(svgText).toContain('<studyflow>');

    const embeddedStudyflow = extractStudyflowFromSvg(svgText);
    const normalizedEmbeddedStudyflow = normalizeXml(embeddedStudyflow);
    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:task\b/);
    expect(normalizedEmbeddedStudyflow).toContain('name="Review Task"');
    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:startEvent\b/);

    await openFileMenu(page);
    const studyflowDownloadPromise = page.waitForEvent('download');
    await page.getByText('Save As...', { exact: true }).click();
    const studyflowDownload = await studyflowDownloadPromise;
    const studyflowText = await readDownloadText(studyflowDownload);

    expect(studyflowDownload.suggestedFilename()).toBe('Untitled Diagram.studyflow');
    expect(normalizeXml(studyflowText)).toBe(normalizedEmbeddedStudyflow);
  });

  test('adds a schema-backed omniflow element and preserves operation defaults', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Create Start Event', { x: 120, y: 160 });
    await addSchemaPaletteElement(page, 'omniflow', 'Map', { x: 320, y: 180 });

    await page.route('https://api.iconify.design/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>',
      });
    });

    await openFileMenu(page);
    const svgDownloadPromise = page.waitForEvent('download');
    await page.getByText('Export to SVG...', { exact: true }).click();
    const svgDownload = await svgDownloadPromise;
    const embeddedStudyflow = extractStudyflowFromSvg(await readDownloadText(svgDownload));
    const normalizedEmbeddedStudyflow = normalizeXml(embeddedStudyflow);

    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:task\b/);
    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:startEvent\b/);
    expect(normalizedEmbeddedStudyflow).toContain('studyflow:isDataOperation="true"');
    expect(normalizedEmbeddedStudyflow).toContain('studyflow:operationType="map"');
    expect(normalizedEmbeddedStudyflow).toContain('<omniflow:map/>');

    await openFileMenu(page);
    const studyflowDownloadPromise = page.waitForEvent('download');
    await page.getByText('Save As...', { exact: true }).click();
    const studyflowDownload = await studyflowDownloadPromise;
    const studyflowText = await readDownloadText(studyflowDownload);
    const normalizedStudyflow = normalizeXml(studyflowText);

    expect(normalizedStudyflow).toContain('studyflow:isDataOperation="true"');
    expect(normalizedStudyflow).toContain('studyflow:operationType="map"');
    expect(normalizedStudyflow).toContain('<omniflow:map/>');
    expect(normalizedStudyflow).toBe(normalizedEmbeddedStudyflow);
  });

  test('applies default schema values for omniflow EEGPrep elements', async ({ page }) => {
    await gotoModeler(page);

    await addSchemaPaletteElement(page, 'omniflow', 'EEGPrep', { x: 260, y: 200 });

    await openFileMenu(page);
    const studyflowDownloadPromise = page.waitForEvent('download');
    await page.getByText('Save As...', { exact: true }).click();
    const studyflowDownload = await studyflowDownloadPromise;
    const normalizedStudyflow = normalizeXml(await readDownloadText(studyflowDownload));

    expect(normalizedStudyflow).toContain('<omniflow:eEGPrep/>');
    expect(normalizedStudyflow).toContain('studyflow:isDataOperation="true"');
    expect(normalizedStudyflow).toContain('studyflow:operationType="map"');
    expect(normalizedStudyflow).toContain('name="EEGPrep.clean_artifacts"');
  });
});