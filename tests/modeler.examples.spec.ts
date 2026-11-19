import { expect, test } from './e2e';

import { STORAGE_KEYS } from '@core/storage';

import { browseForDiagram, exampleText, fileTitle, gotoModeler, runPaletteCommand, studyName } from './utils';

/**
 * The New Study dialog, a start page: the empty study and the templates the skills feature, the files opened lately,
 * and every shipped example on its skill's shelf under All templates.
 */

test.describe('New Study', () => {
  test('the start page leads with the empty study and the featured templates; All templates shelves every example, and a card opens it', async ({ page }) => {
    await gotoModeler(page);
    await runPaletteCommand(page, /^New/);

    const dialog = page.getByTestId('gallery-dialog');
    await expect(dialog).toBeVisible();

    // The start page: a description is not read yet, and the row is the empty study and what the skills feature.
    await expect(dialog.getByRole('textbox', { name: 'Describe a study or an analysis' })).toBeDisabled();
    await expect(dialog.getByRole('listitem')).toHaveCount(4);
    await expect(page.getByTestId('new-diagram-blank')).toBeVisible();
    for (const featured of ['cognitive_battery', 'sklearn_pipeline', 'reachy_session']) {
      await expect(page.getByTestId(`example-${featured}`)).toBeVisible();
    }
    await expect(page.getByTestId('example-reachy_pools')).toHaveCount(0);
    // A browser without the file pickers, as here, keeps no recent files to list.
    await expect(page.getByTestId('recent-files')).toHaveCount(0);

    const card = page.getByTestId('example-cognitive_battery');
    await expect(card).toContainText('Within-subject cognitive battery');
    await expect(card).toHaveAttribute('title', /Chains N-Back, Digit Span, SART/);

    // cognitive_battery ships as YAML, so its picture is drawn in the page.
    const preview = card.getByTestId('example-thumb');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('src', /^blob:/);
    // A picture decodes after it is visible: wait for it rather than read it once.
    await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    // All templates turns the page to every example, and Back turns it to the start again.
    await dialog.getByRole('button', { name: 'All templates' }).click();
    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByTestId('example-reachy_pools')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'All templates' }).click();

    // The badge is the icon of the schema its skill ships: an icon class (cognitive's), or a data
    // URL drawn as an image (reachy's); python ships a runner and no schema, so no badge.
    await expect(card.getByTestId('example-badge')).toBeVisible();
    const reachy = page.getByTestId('example-reachy_pools').getByTestId('example-badge').locator('img');
    await expect(reachy).toBeVisible();
    await expect.poll(() => reachy.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByTestId('example-sklearn_pipeline').getByTestId('example-badge')).toHaveCount(0);

    // A shelf holds its skill's examples, and the blank card leads every shelf.
    await expect(page.getByTestId('new-diagram-blank')).toBeVisible();
    await page.getByTestId('example-filter-cognitive').click();
    await expect(card).toBeVisible();
    await expect(page.getByTestId('example-consort2025')).toHaveCount(0);
    await expect(page.getByTestId('new-diagram-blank')).toBeVisible();
    await page.getByTestId('example-filter-all').click();
    await expect(page.getByTestId('example-consort2025')).toBeVisible();

    await card.click();
    await expect(dialog).toBeHidden();
    await expect(studyName(page)).toHaveValue('Within-subject cognitive battery');
    await expect(page.locator('g[data-element-id="Task_NBack"]')).toBeVisible();
    // It opens fitted to what the app's floating chrome leaves free, and a reload restores it fitted the same way.
    const clearsPalette = async () => {
      const palette = (await page.getByTestId('palette-root').boundingBox())!;
      const start = (await page.locator('g[data-element-id="Start"]').boundingBox())!;
      expect(start.x).toBeGreaterThan(palette.x + palette.width);
    };
    await clearsPalette();
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) ?? '', STORAGE_KEYS.autosaveDiagram)).toContain('Task_NBack');
    await page.reload();
    await expect(page.getByTestId('modeler-ready')).toBeAttached({ timeout: 30_000 });
    await clearsPalette();

    // The blank diagram is one click away, and replaces the one open.
    await runPaletteCommand(page, /^New/);
    await page.getByTestId('new-diagram-blank').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('g[data-element-id="StartEvent_1"]')).toBeVisible();
    await expect(page.locator('g[data-element-id="Task_NBack"]')).toHaveCount(0);
  });
});

/**
 * The recent files of the disk's are file handles the browser keeps. The bundled Chromium closes when an
 * off-the-record page reads one back, so this flow runs in a context with a profile of its own.
 */
const withProfile = test.extend({
  context: async ({ playwright, baseURL, viewport, headless, contextOptions }, use, testInfo) => {
    const context = await playwright.chromium.launchPersistentContext(testInfo.outputPath('profile'), { ...contextOptions, baseURL, viewport, headless });
    await use(context);
    await context.close();
  },
});

test.describe('Recent files', () => {
  withProfile('a file opened from disk is listed under Recent with the ones `studyflow ui` opened, newest first, opens again from there, and leaves the list once it is gone', async ({ page }) => {
    // The origin's private file system hands out real handles, which the browser can keep; the picker returns the last file written.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async () => [await (await navigator.storage.getDirectory()).getFileHandle(sessionStorage.getItem('picked')!)],
      });
    });
    const write = (name: string, text: string) => page.evaluate(async ({ name, text }) => {
      const handle = await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      sessionStorage.setItem('picked', name);
    }, { name, text });
    const open = async (name: string, example: string) => {
      await write(name, exampleText(example));
      await browseForDiagram(page);
      await expect(fileTitle(page)).toContainText(name);
    };

    // The desktop app's server (packages/desktop/recent.ts): the list of the files it opened, each at a path that takes a
    // POST when the page opens it again.
    const SERVED = '/recent/0/served.studyflow.yaml';
    const told: string[] = [];
    await page.route('**/recent.json', (route) => route.fulfill({ json: [{ url: SERVED, name: 'served.studyflow.yaml', openedAt: 1000 }] }));
    await page.route(`**${SERVED}`, async (route) => {
      told.push(route.request().method());
      await route.fulfill({ body: exampleText('lablink_demo0'), contentType: 'text/yaml', headers: { 'x-studyflow-modified': '1000' } });
    });

    await gotoModeler(page, { pickers: true });
    await open('first.studyflow.yaml', 'drawn_loop');
    await open('second.studyflow.yaml', 'choreography_demo');

    // The list outlives the page.
    await page.reload();
    await expect(page.getByTestId('modeler-ready')).toBeAttached({ timeout: 30_000 });
    await runPaletteCommand(page, /^New/);
    const recent = page.getByTestId('recent-files').getByRole('button');
    await expect(recent).toHaveText([/^second\.studyflow\.yaml/, /^first\.studyflow\.yaml/, /^served\.studyflow\.yaml/]);

    // A press opens the file, linked as a picked one is, and puts it first.
    await recent.nth(1).click();
    await expect(page.getByTestId('gallery-dialog')).toBeHidden();
    await expect(fileTitle(page)).toContainText('first.studyflow.yaml');
    await expect(fileTitle(page)).toHaveAttribute('data-file-place', 'disk');
    await expect(studyName(page)).toHaveValue(/loop/i);
    await runPaletteCommand(page, /^New/);
    await expect(recent).toHaveText([/^first\.studyflow\.yaml/, /^second\.studyflow\.yaml/, /^served\.studyflow\.yaml/]);

    // A file that is no longer there says so, and leaves the list.
    await page.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry('second.studyflow.yaml'));
    await recent.nth(1).click();
    await expect(page.getByText('second.studyflow.yaml is no longer where it was.')).toBeVisible();
    await expect(recent).toHaveText([/^first\.studyflow\.yaml/, /^served\.studyflow\.yaml/]);

    // The served one opens over its path, where saves go back, and the server hears that it was opened.
    await recent.nth(1).click();
    await expect(page.getByTestId('gallery-dialog')).toBeHidden();
    await expect(fileTitle(page)).toContainText('served.studyflow.yaml');
    await expect(fileTitle(page)).toHaveAttribute('data-file-place', 'disk');
    await expect.poll(() => told).toContain('POST');
    await runPaletteCommand(page, /^New/);
    await expect(recent).toHaveText([/^served\.studyflow\.yaml/, /^first\.studyflow\.yaml/]);
  });
});
