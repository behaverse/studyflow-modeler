import { expect, test } from '@playwright/test';

import { gotoModeler, runPaletteCommand } from './utils';

/** The New Diagram gallery: the blank card, then one card per shipped example, in shelves. */

test.describe('New Diagram gallery', () => {
  test('a card previews its diagram and opens it', async ({ page }) => {
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

    await card.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTitle('Click to edit diagram name'))
      .toHaveText('Within-subject cognitive battery');
    await expect(page.locator('g[data-element-id="Task_NBack"]')).toBeVisible();
  });

  test('a YAML example that needs a skill turned off is left out; a PNG one stays', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('studyflow-modeler:settings', JSON.stringify({ enabledSchemas: [] })));
    await gotoModeler(page);
    await runPaletteCommand(page, 'New...');

    // Read and drawn: sklearn_pipeline needs only the core schemas.
    await expect(page.getByTestId('example-sklearn_pipeline')).toContainText('scikit-learn');
    // kitchensink and agent_eval name agentic types; bot_external is a PNG, which opens without its schema.
    await expect(page.getByTestId('example-kitchensink')).toHaveCount(0);
    await expect(page.getByTestId('example-agent_eval')).toHaveCount(0);
    await expect(page.getByTestId('example-bot_external')).toBeVisible();
  });

  test('a pool diagram is read from both its roots', async ({ page }) => {
    // spirit2025 splits its card across both roots: name on the collaboration, documentation on the process.
    await gotoModeler(page);
    await runPaletteCommand(page, 'New...');

    const card = page.getByTestId('example-spirit2025');
    await expect(card).toContainText('studyflow');                   // its skill
    await expect(card).toContainText('SPIRIT 2025 trial protocol'); // collaboration
    await expect(card).toContainText('A SPIRIT 2025 trial protocol in lanes'); // process
  });

  test('a card wears its skill\'s schema icon, when the skill has a schema', async ({ page }) => {
    await gotoModeler(page);
    await runPaletteCommand(page, 'New...');

    await expect(page.getByTestId('example-bot_claude').getByTestId('example-badge')).toBeVisible();
    // reachy's icon is a data URL, drawn as an image rather than an icon class.
    const reachy = page.getByTestId('example-reachy_pools').getByTestId('example-badge').locator('img');
    await expect(reachy).toBeVisible();
    expect(await reachy.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    // python ships a runner and no schema.
    await expect(page.getByTestId('example-sklearn_pipeline').getByTestId('example-badge')).toHaveCount(0);
  });

  test('category chips filter the gallery', async ({ page }) => {
    await gotoModeler(page);
    await runPaletteCommand(page, 'New...');

    await expect(page.getByTestId('example-consort2025')).toBeVisible();
    await expect(page.getByTestId('example-bot_claude')).toBeVisible();

    await page.getByTestId('example-filter-behaverse').click();
    await expect(page.getByTestId('example-bot_claude')).toBeVisible();
    await expect(page.getByTestId('example-consort2025')).toHaveCount(0);

    await page.getByTestId('example-filter-all').click();
    await expect(page.getByTestId('example-consort2025')).toBeVisible();
  });

  test('the empty diagram is always one click away, but only shelved under All', async ({ page }) => {
    await gotoModeler(page);
    await runPaletteCommand(page, 'New...');

    // The card sits with the examples, where "start from nothing" is one of the options.
    await expect(page.getByTestId('new-diagram-blank-card')).toBeVisible();

    await page.getByTestId('example-filter-behaverse').click();
    // A shelf holds what it says it holds; the blank card is not a Behaverse example.
    await expect(page.getByTestId('new-diagram-blank-card')).toHaveCount(0);
    // The header button never goes away, whatever shelf is open.
    await expect(page.getByTestId('new-diagram-blank')).toBeVisible();

    await page.getByTestId('new-diagram-blank').click();
    await expect(page.getByTestId('gallery-dialog')).toBeHidden();
    await expect(page.locator('g[data-element-id="StartEvent_1"]')).toBeVisible();
  });
});
