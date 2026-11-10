import { expect, test } from '@tests/e2e';

import { STORAGE_KEYS } from '@core/storage';
import { diagramTitle, examplePath, gotoModeler, openCommandPalette, readDownloadText, runPaletteCommand } from '@tests/utils';

/** The Reporting Diagram view on the skill's documents: what each draws is pinned by reporting-documents.unit.spec.ts. */

test('the Reporting Diagram view lists the documents of the guidelines in use, shows the one picked, saves it, and goes with its extension', async ({ page }) => {
  await gotoModeler(page);
  await page.getByTestId('open-file-input').setInputFiles(examplePath('spirit2025'));
  await expect(diagramTitle(page)).toHaveText('SPIRIT 2025 trial protocol');
  await runPaletteCommand(page, /^View as Reporting Diagram/);

  const dialog = page.getByTestId('reporting-dialog');
  const figure = dialog.getByTestId('reporting-figure');
  // One tab per document, the first shown: the picture, drawn from the study that is open.
  await expect(dialog.getByRole('tab')).toHaveText(['CONSORT 2025 · Participant flow', 'SPIRIT 2025 · Schedule']);
  await expect(figure).toHaveAttribute('alt', 'CONSORT 2025: Participant flow');
  await expect.poll(() => figure.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await dialog.getByTestId('reporting-spirit-2025-schedule').click();
  await expect(figure).toHaveAttribute('alt', 'SPIRIT 2025: Schedule');
  await expect.poll(() => figure.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // The download is the picture shown, named for the study and the document.
  const download = page.waitForEvent('download');
  await dialog.getByTestId('reporting-download').click();
  const svg = await download;
  expect(svg.suggestedFilename()).toBe('SPIRIT 2025 trial protocol.spirit-2025-schedule.svg');
  const text = await readDownloadText(svg);
  expect(text).toContain('<title>SPIRIT 2025 schedule of enrollment, interventions and assessments: SPIRIT 2025 trial protocol</title>');
  expect(text).toContain('>Intervention: cognitive training</text>');

  // The documents are the skill's: with its extension switched off, nothing draws one, and the command goes.
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ disabledSchemas: ['reporting'] })), STORAGE_KEYS.settings);
  await page.reload();
  await expect(page.getByTestId('modeler-ready')).toBeAttached({ timeout: 30_000 });
  await openCommandPalette(page);
  await expect(page.getByRole('dialog').getByRole('button', { name: /^View as Schedule/ })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: /^View as Reporting Diagram/ })).toHaveCount(0);
});
