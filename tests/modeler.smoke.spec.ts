import { expect, test } from './e2e';

import { STORAGE_KEYS } from '@core/storage';

import { SCHEMAS } from './schemas';
import { addPaletteElement, gotoModeler, openCommandPalette, runPaletteCommand } from './utils';

test.describe('Studyflow modeler smoke', () => {
  test('loads the modeler shell, whose Gantt view opens from the command palette', async ({ page }) => {
    await gotoModeler(page);

    await expect(page.getByRole('button', { name: /command palette/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^simulate$/i })).toBeVisible();

    await openCommandPalette(page);
    const dialog = page.getByRole('dialog');
    // The File group is a row of tiles with no header; the others are headed ('Run' is skipped: it collides with the Run command label).
    await expect(dialog.getByRole('button', { name: /^New\b/ })).toBeVisible();
    await expect(dialog.getByText(/^View$/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await expect(page.getByTestId('palette-root')).toBeVisible();
    await expect(page.getByTestId('inspector-shell')).toBeAttached();
    await expect(page.getByTestId('inspector-root')).toBeVisible();
    await expect(page.getByTestId('modeler-loading')).toHaveCount(0);

    await runPaletteCommand(page, /gantt/i);
    const gantt = page.getByRole('heading', { name: /gantt/i });
    await expect(gantt).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(gantt).toBeHidden();
  });

  test('Settings: Auto-save off drops the kept copy, a skill switched off leaves the palette on reload, and a reset or a clear the browser cannot store still applies, with one warning', async ({ page }) => {
    await gotoModeler(page);
    const autosaved = () => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.autosaveDiagram);
    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await expect.poll(autosaved).not.toBeNull();
    await runPaletteCommand(page, /^Settings/);
    const autoSave = page.getByRole('combobox', { name: 'Auto-save' });
    await autoSave.selectOption('off');
    await expect.poll(autosaved).toBeNull();

    // Extensions lists every schema the app loads, each a switch, a required one locked on.
    await page.getByRole('button', { name: 'Extensions' }).click();
    for (const schema of SCHEMAS) {
      const toggle = page.getByRole('switch', { name: new RegExp(`\\b${schema.name}\\b`) });
      await expect(toggle).toBeAttached();
      if (schema.required) await expect(toggle).toBeDisabled();
    }
    await expect(page.getByRole('img', { name: /required/i }))
      .toHaveCount(SCHEMAS.filter((schema) => schema.required).length);
    await page.getByRole('switch', { name: 'Load the Reachy Mini elements' }).click();
    await page.getByRole('button', { name: 'Reload now' }).click();
    await expect(page.getByTestId('modeler-ready')).toBeAttached({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Reachy Mini elements...' })).toHaveCount(0);

    // With the settings' writes blocked, a reset still applies for the session, and clearing the local data still takes
    // every key the app keeps, the settings stored before included; that neither was kept is said once.
    await page.evaluate((key) => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, name: string, value: string) {
        if (name === key) throw new DOMException('blocked', 'SecurityError');
        setItem.call(this, name, value);
      };
    }, STORAGE_KEYS.settings);
    await runPaletteCommand(page, /^Settings/);
    const privacy = page.getByRole('button', { name: 'Privacy' });
    await privacy.click();
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await page.getByRole('button', { name: 'Editor' }).click();
    await expect(autoSave).toHaveValue('local');
    await privacy.click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Clear all local data' }).click();
    await expect(page.getByText('0 keys, ~0 B')).toBeVisible();
    await expect(page.getByTestId('notices').getByText(/^Settings could not be saved: this browser blocks local storage/)).toHaveCount(1);
  });
});
