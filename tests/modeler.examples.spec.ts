import { expect, test } from '@playwright/test';

import { gotoModeler, runPaletteCommand } from './utils';

/** The Examples gallery: a card per shipped diagram, grouped into categories. */

test.describe('Examples gallery', () => {
  test('a card previews its diagram and opens it', async ({ page }) => {
    await gotoModeler(page);
    await runPaletteCommand(page, 'Examples...');

    const dialog = page.getByTestId('examples-dialog');
    await expect(dialog).toBeVisible();

    const card = page.getByTestId('example-cognitive_battery');
    await expect(card).toContainText('Within-subject cognitive battery');
    await expect(card).toContainText('Chains N-Back, Digit Span, SART');

    const preview = card.locator('img');
    await expect(preview).toBeVisible();
    expect(await preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    await card.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTitle('Click to edit diagram name'))
      .toHaveText('Within-subject cognitive battery');
    await expect(page.locator('g[data-element-id="Task_NBack"]')).toBeVisible();
  });

  test('a pool diagram is read from both its roots', async ({ page }) => {
    // spirit2025 splits its card across both roots: name/shelf on the collaboration, documentation on the process.
    await gotoModeler(page);
    await runPaletteCommand(page, 'Examples...');

    const card = page.getByTestId('example-spirit2025');
    await expect(card).toContainText('Study designs');              // collaboration
    await expect(card).toContainText('SPIRIT 2025 trial protocol'); // collaboration
    await expect(card).toContainText('A SPIRIT 2025 trial protocol in lanes'); // process
  });

  test('category chips filter the gallery', async ({ page }) => {
    await gotoModeler(page);
    await runPaletteCommand(page, 'Examples...');

    await expect(page.getByTestId('example-consort2025')).toBeVisible();
    await expect(page.getByTestId('example-bot_claude')).toBeVisible();

    await page.getByTestId('example-filter-AI agents').click();
    await expect(page.getByTestId('example-bot_claude')).toBeVisible();
    await expect(page.getByTestId('example-consort2025')).toHaveCount(0);

    await page.getByTestId('example-filter-all').click();
    await expect(page.getByTestId('example-consort2025')).toBeVisible();
  });
});
