import { expect, test, type Locator, type Page } from '@playwright/test';

import { exampleFile, exampleXml, gotoModeler, runPaletteCommand } from './utils';

/**
 * Token placement in the simulator and the provenance replay across containers:
 * expanded sub-processes are walked through their own start events, pools and lanes
 * are seen through, and a drill-down mid-animation hides tokens off its plane
 * instead of restarting them. `sklearn_pipeline` ships an expanded (`prepare_data`)
 * and a collapsed (`select_model`) sub-process; `reachy_participant` a pool.
 */

async function openExample(page: Page, filename: string, xml?: string): Promise<void> {
  await gotoModeler(page);
  await page.getByTestId('open-file-input').setInputFiles(xml
    ? { name: filename.replace(/\.png$/, ''), mimeType: 'application/xml', buffer: Buffer.from(xml) }
    : { name: filename, mimeType: 'image/png', buffer: exampleFile(filename) });
  await expect(page.getByTestId('modeler-ready')).toBeAttached();
}

const box = (locator: Locator) => locator.evaluate((el) => {
  const r = (el as Element).getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, display: getComputedStyle(el as Element).display };
});

const tokens = (page: Page, selector: string) => page.locator(selector).evaluateAll((els) => els.map((el) => {
  const r = el.getBoundingClientRect();
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, shown: getComputedStyle(el).display !== 'none' };
}));

const inside = (p: { cx: number; cy: number }, b: { x: number; y: number; w: number; h: number }, pad = 2) =>
  p.cx >= b.x - pad && p.cx <= b.x + b.w + pad && p.cy >= b.y - pad && p.cy <= b.y + b.h + pad;

const shape = (page: Page, id: string) => page.locator(`g[data-element-id="${id}"]`);
const drilldown = (page: Page, id: string) => shape(page, id).click({ position: { x: 12, y: 12 } })
  .then(() => page.getByTestId('context-pad-drilldown').click());

test.describe('token simulation', () => {
  test('tokens walk into an expanded sub-process and survive leaving a drilled-down plane', async ({ page }) => {
    await openExample(page, 'sklearn_pipeline.studyflow.png');
    await page.getByRole('button', { name: 'Simulate' }).click();

    // Some token reaches the inner tasks of `prepare_data`, which the walk used to skip.
    const inner = await Promise.all(['select_features', 'select_target', 'split_train_test'].map((id) => box(shape(page, id))));
    await expect.poll(async () => (await tokens(page, '.studyflow-simulation-token'))
      .some((t) => t.shown && inner.some((b) => inside(t, b))), { timeout: 15_000 }).toBe(true);
    await page.getByTitle('Stop simulation').click();

    // Simulating inside the expanded container: tokens spawn at its own start and stay in its frame.
    await drilldown(page, 'prepare_data');
    await expect(shape(page, 'start_analysis')).toBeHidden();
    await page.getByRole('button', { name: 'Simulate' }).click();
    // The container's own frame is not drawn on its plane, so its contents give the bounds.
    const contents = await Promise.all(['prepare_start', ...['select_features', 'select_target', 'split_train_test'], 'prepare_end'].map((id) => box(shape(page, id))));
    const frame = {
      x: Math.min(...contents.map((b) => b.x)),
      y: Math.min(...contents.map((b) => b.y)),
      w: Math.max(...contents.map((b) => b.x + b.w)) - Math.min(...contents.map((b) => b.x)),
      h: Math.max(...contents.map((b) => b.y + b.h)) - Math.min(...contents.map((b) => b.y)),
    };
    await expect.poll(async () => {
      // Tokens that leave through `prepare_end` walk the hidden root plane, so only the shown ones count.
      const all = await tokens(page, '.studyflow-simulation-token');
      return all.some((t) => t.shown) && all.filter((t) => t.shown).every((t) => inside(t, frame, 12));
    }, { timeout: 10_000 }).toBe(true);

    // Leaving the plane mid-animation keeps them walking: nothing restarts, and they carry on
    // out of the container onto the root plane.
    await page.getByTestId('breadcrumb-sklearn_pipeline').click();
    const root = await box(shape(page, 'prepare_data'));
    await expect.poll(async () => (await tokens(page, '.studyflow-simulation-token')).every((t) => t.shown)).toBe(true);
    await expect.poll(async () => (await tokens(page, '.studyflow-simulation-token'))
      .some((t) => t.shown && !inside(t, root, 12)), { timeout: 15_000 }).toBe(true);
    await page.getByTitle('Stop simulation').click();

    // A collapsed sub-process spawns tokens at its own start event; leaving its plane hides
    // the ones still inside instead of dropping them.
    await drilldown(page, 'select_model');
    await expect(shape(page, 'build_pipeline')).toBeVisible();
    await page.getByRole('button', { name: 'Simulate' }).click();
    const plane = await box(shape(page, 'build_pipeline'));
    await expect.poll(async () => (await tokens(page, '.studyflow-simulation-token'))
      .some((t) => t.shown && Math.abs(t.cy - (plane.y + plane.h / 2)) < plane.h), { timeout: 10_000 }).toBe(true);
    await page.getByTestId('breadcrumb-sklearn_pipeline').click();
    await expect.poll(async () => (await tokens(page, '.studyflow-simulation-token')).some((t) => !t.shown)).toBe(true);
    await expect.poll(async () => (await tokens(page, '.studyflow-simulation-token')).some((t) => t.shown)).toBe(true);
  });

  test('a start event inside a pool spawns tokens', async ({ page }) => {
    await openExample(page, 'reachy_participant.studyflow.png');
    await page.getByRole('button', { name: 'Simulate' }).click();
    await expect(page.locator('.studyflow-simulation-token').first()).toBeVisible();
    const start = await box(shape(page, 'Seated'));
    await expect.poll(async () => (await tokens(page, '.studyflow-simulation-token'))
      .some((t) => t.shown && !inside(t, start, -4)), { timeout: 10_000 }).toBe(true);
  });
});

/** Stamp an `executed` record on `id`, into the extension elements the example already gives it. */
function stamped(xml: string, id: string, when: string): string {
  const ext = new RegExp(`(<bpmn:\\w+ id="${id}"[^>]*>[\\s\\S]*?<bpmn:extensionElements>)`);
  expect(xml).toMatch(ext);
  return xml.replace(ext, `$1<prov:activity action="executed" when="${when}" />`);
}

test('the replay enters and leaves the plane of the element a record names', async ({ page }) => {
  let xml = exampleXml('sklearn_pipeline.studyflow.png');
  xml = stamped(xml, 'start_analysis', '2026-09-01T10:00:00Z');
  xml = stamped(xml, 'cross_validate', '2026-09-01T10:00:05Z');
  await openExample(page, 'sklearn_pipeline.studyflow.png', xml);
  await runPaletteCommand(page, 'Replay');
  const replay = page.getByTestId('provenance-replay');
  await replay.getByRole('button', { name: 'Jump to end' }).click();

  // `cross_validate` lives in the collapsed `select_model`: the replay drills in and lands on it.
  await expect(shape(page, 'cross_validate')).toBeVisible({ timeout: 10_000 });
  await expect(shape(page, 'prepare_data')).toBeHidden();
  await expect.poll(async () => {
    const [token] = await tokens(page, '.studyflow-replay-token');
    return token?.shown && inside(token, await box(shape(page, 'cross_validate')));
  }, { timeout: 10_000 }).toBe(true);

  // Stepping back to the root-plane record surfaces again.
  await replay.getByRole('button', { name: 'Step back' }).click();
  await expect(shape(page, 'start_analysis')).toBeVisible({ timeout: 10_000 });
  await expect(shape(page, 'cross_validate')).toBeHidden();
  await expect.poll(async () => {
    const [token] = await tokens(page, '.studyflow-replay-token');
    return token?.shown && inside(token, await box(shape(page, 'start_analysis')));
  }, { timeout: 10_000 }).toBe(true);
});
