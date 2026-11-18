import { expect, test } from './e2e';

import { exampleText, gotoModeler } from './utils';

/** The desktop app's server (packages/desktop/serve.ts) as the modeler sees it: the file with its mtime, and a PUT. */
const SERVED = '/open/review.studyflow.yaml';

const FIRST = exampleText('lablink_demo0');
/** What an assistant writes through `studyflow mcp`: the end renamed, and a step added beside it. */
const ASSISTANTS = FIRST
  .replace('name: Done', 'name: All done')
  .replace('    Flow_Start_End:', '    Consent:\n      type: Task\n      name: Give consent\n\n    Flow_Start_End:')
  .replace('  Flow_Start_End: 236,218 600,218', '  Consent: {bounds: 360 300 100 80}\n  Flow_Start_End: 236,218 600,218');
/** A second version it writes, which the user turns down. */
const DISCARDED = FIRST.replace('name: Participant arrives', 'name: Someone arrives');

test('a version written into the linked file comes in for review: Accept keeps it, Discard writes the canvas\'s back', async ({ page }) => {
  let disk = { text: FIRST, modified: 1000 };
  const writes: string[] = [];
  await page.route(`**${SERVED}`, async (route) => {
    if (route.request().method() === 'PUT') {
      writes.push(route.request().postData() ?? '');
      disk = { text: writes.at(-1)!, modified: disk.modified + 1 };
      await route.fulfill({ status: 204, headers: { 'x-studyflow-modified': String(disk.modified) } });
      return;
    }
    await route.fulfill({ body: disk.text, contentType: 'text/yaml', headers: { 'x-studyflow-modified': String(disk.modified) } });
  });
  await gotoModeler(page, { url: `/app?open=${encodeURIComponent(SERVED)}` });
  const composer = page.getByTestId('composer');
  const app = page.getByTestId('modeler-app');
  const end = page.locator('g[data-element-id="End"]');
  const consent = page.locator('g[data-element-id="Consent"]');
  const list = page.getByTestId('review-list');
  await expect(end).toBeVisible();
  await expect(consent).toHaveCount(0);

  // The assistant saves: the version comes onto the canvas, read-only, and the composer says what it changes.
  disk = { text: ASSISTANTS, modified: 2000 };
  await expect(composer).toHaveAttribute('data-face', 'review', { timeout: 10_000 });
  await expect(app).toHaveClass(/review-active/);
  await expect(consent).toHaveClass(/sf-mark-review-added/);
  await expect(end).toHaveClass(/sf-mark-review-changed/);
  await composer.getByTestId('review-changes').click();
  await expect(list).toContainText('Give consent');
  await expect(list).toContainText(/All done\s*name/);
  await page.keyboard.press('Escape');
  // The inspector shows the version, read-only, and says what it did to the element shown.
  await end.click();
  await expect(page.getByTestId('inspector-review')).toContainText('Changed on disk: name');
  await expect(page.locator('[name="bpmn:name"]')).toBeDisabled();

  // Accept keeps it: the canvas edits again, its marks gone, and holds what the file holds, so nothing is written.
  await composer.getByRole('button', { name: 'Accept' }).click();
  await expect(composer).not.toHaveAttribute('data-face', 'review');
  await expect(app).not.toHaveClass(/review-active/);
  await expect(consent).toBeVisible();
  await expect(consent).not.toHaveClass(/sf-mark-review-added/);
  expect(writes).toHaveLength(0);

  // Another version, turned down: the canvas goes back to its own, and auto-save writes it over the file.
  disk = { text: DISCARDED, modified: 3000 };
  await expect(composer).toHaveAttribute('data-face', 'review', { timeout: 10_000 });
  await composer.getByTestId('review-changes').click();
  await expect(list).toContainText(/Someone arrives\s*name/);
  await page.keyboard.press('Escape');
  await composer.getByRole('button', { name: 'Discard' }).click();
  await expect(composer).not.toHaveAttribute('data-face', 'review');
  await expect.poll(() => writes.length).toBe(1);
  // The file gets the canvas's version back: the one accepted before, with the name the user kept.
  expect(writes[0]).toContain('Participant arrives');
  expect(writes[0]).not.toContain('Someone arrives');
  expect(writes[0]).toContain('All done');
  expect(writes[0]).toContain('Give consent');
});
