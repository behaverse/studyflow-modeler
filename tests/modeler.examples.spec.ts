import { expect, test } from '@playwright/test';

import { gotoModeler, runPaletteCommand } from './utils';

/** The New Diagram gallery: the blank card, then one card per shipped example, in shelves. */

test.describe('New Diagram gallery', () => {
  test('a card previews its diagram, wears its skill\'s icon, sits on its shelf, and opens it', async ({ page }) => {
    await gotoModeler(page);
    await runPaletteCommand(page, 'New...');

    const dialog = page.getByTestId('gallery-dialog');
    await expect(dialog).toBeVisible();

    const card = page.getByTestId('example-cognitive_battery');
    await expect(card).toContainText('Within-subject cognitive battery');
    await expect(card).toContainText('Chains N-Back, Digit Span, SART');

    // cognitive_battery ships as YAML, so its picture is drawn in the page.
    const preview = card.getByTestId('example-thumb');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('src', /^blob:/);
    expect(await preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    // The badge is the icon of the schema its skill ships: an icon class (cognitive's), or a data
    // URL drawn as an image (reachy's); python ships a runner and no schema, so no badge.
    await expect(card.getByTestId('example-badge')).toBeVisible();
    const reachy = page.getByTestId('example-reachy_pools').getByTestId('example-badge').locator('img');
    await expect(reachy).toBeVisible();
    expect(await reachy.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByTestId('example-sklearn_pipeline').getByTestId('example-badge')).toHaveCount(0);

    // A shelf holds its skill's examples; the blank card sits under All only, while the header's
    // blank button stays whatever shelf is open.
    await expect(page.getByTestId('new-diagram-blank-card')).toBeVisible();
    await page.getByTestId('example-filter-cognitive').click();
    await expect(card).toBeVisible();
    await expect(page.getByTestId('example-consort2025')).toHaveCount(0);
    await expect(page.getByTestId('new-diagram-blank-card')).toHaveCount(0);
    await expect(page.getByTestId('new-diagram-blank')).toBeVisible();
    await page.getByTestId('example-filter-all').click();
    await expect(page.getByTestId('example-consort2025')).toBeVisible();

    await card.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTitle('Click to edit diagram name'))
      .toHaveText('Within-subject cognitive battery');
    await expect(page.locator('g[data-element-id="Task_NBack"]')).toBeVisible();

    // The blank diagram is one click away, and replaces the one open.
    await runPaletteCommand(page, 'New...');
    await page.getByTestId('new-diagram-blank').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('g[data-element-id="StartEvent_1"]')).toBeVisible();
    await expect(page.locator('g[data-element-id="Task_NBack"]')).toHaveCount(0);
  });
});
