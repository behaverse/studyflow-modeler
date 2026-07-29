import { expect, test } from '@playwright/test';

import { gotoModeler, runPaletteCommand } from './utils';

/**
 * The Examples gallery: a card per shipped diagram, grouped into categories
 * and previewed by the diagram itself.
 *
 * The preview is the load-bearing part — it is what tells a newcomer what a
 * study *looks like* before opening it — so these check that the image really
 * renders (a broken `src` still lays out) and that a card opens the diagram it
 * pictures.
 */

test.describe('Examples gallery', () => {
  test('a card previews its diagram and opens it', async ({ page }) => {
    await gotoModeler(page);
    await runPaletteCommand(page, 'Examples...');

    const dialog = page.getByTestId('examples-dialog');
    await expect(dialog).toBeVisible();

    const card = page.getByTestId('example-cognitive_battery');
    // Title and one-sentence blurb come from the diagram's own documentation.
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

  test('category chips filter the gallery', async ({ page }) => {
    await gotoModeler(page);
    await runPaletteCommand(page, 'Examples...');

    // Everything shows until a category is picked.
    await expect(page.getByTestId('example-consort2025')).toBeVisible();
    await expect(page.getByTestId('example-bot_claude')).toBeVisible();

    await page.getByTestId('example-filter-AI agents').click();
    await expect(page.getByTestId('example-bot_claude')).toBeVisible();
    await expect(page.getByTestId('example-consort2025')).toHaveCount(0);

    await page.getByTestId('example-filter-all').click();
    await expect(page.getByTestId('example-consort2025')).toBeVisible();
  });
});
