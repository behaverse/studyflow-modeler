import { expect, test } from './e2e';

import { STORAGE_KEYS } from '@core/storage';

import { SCHEMAS } from './schemas';
import { addPaletteElement, gotoModeler, openCommandPalette, runPaletteCommand } from './utils';

test.describe('Studyflow modeler smoke', () => {
  test('loads the modeler shell, whose Schedule view opens in the drawer from the command palette', async ({ page }) => {
    await gotoModeler(page);

    await expect(page.getByRole('button', { name: /command palette/i })).toBeVisible();
    // A blank study opens on the composer's first step.
    const composer = page.getByTestId('composer');
    await expect(composer).toHaveAttribute('data-face', 'home');

    await openCommandPalette(page);
    const dialog = page.getByRole('dialog');
    // Unsearched, it lists what is at hand, the study's commands; the app menu's own are found by name.
    await expect(dialog.getByText(/^View$/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^New\b/ })).toHaveCount(0);
    await dialog.getByRole('textbox', { name: /search/i }).fill('new');
    await expect(dialog.getByRole('button', { name: /^New\b/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await expect(page.getByTestId('palette-root')).toBeVisible();
    await expect(page.getByTestId('inspector-shell')).toBeAttached();
    await expect(page.getByTestId('inspector-root')).toBeVisible();
    await expect(page.getByTestId('modeler-loading')).toHaveCount(0);

    // A first shape turns the composer to designing, with Simulate.
    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await expect(composer).not.toHaveAttribute('data-face', 'home');
    await expect(composer.getByRole('button', { name: /^simulate$/i })).toBeVisible();

    // The selection is one thing everywhere it shows. Escape closes the innermost thing first: the new task's name
    // editor, then the palette the composer opens on it (whose first group is the pad's commands), then the selection.
    await page.keyboard.press('Escape');
    await expect(composer).toHaveAttribute('data-face', 'selection');
    const prompt = page.getByTestId('composer-prompt');
    await prompt.click();
    await expect(page.getByRole('dialog').getByText(/^Selection$/)).toBeVisible();
    await page.keyboard.press('Escape');
    // The palette gives the focus back to the prompt it opened from, with the selection still there.
    await expect(prompt).toBeFocused();
    await expect(composer).toHaveAttribute('data-face', 'selection');
    await page.keyboard.press('Escape');
    await expect(composer).toHaveAttribute('data-face', 'design');
    await expect(page.getByTestId('inspector-root').getByRole('heading', { level: 2 })).toHaveText('studyflow:Study');

    // The schedule opens in the drawer under the canvas, which the composer's toggle closes and opens again.
    await runPaletteCommand(page, /schedule/i);
    const drawer = page.getByTestId('views-drawer');
    await expect(drawer.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
    await composer.getByRole('button', { name: 'Views' }).click();
    await expect(drawer).toBeHidden();
    await composer.getByRole('button', { name: 'Views' }).click();
    await expect(drawer.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
    // Maximized, it stands as a dialog over the app; Esc puts it back under the canvas.
    await drawer.getByRole('button', { name: 'Maximize views' }).click();
    await expect(drawer).toHaveAttribute('role', 'dialog');
    await page.keyboard.press('Escape');
    await expect(drawer).not.toHaveAttribute('role', 'dialog');
  });

  test('Settings: Auto-save off drops the kept copy, a skill switched off leaves the palette on reload and one switched on joins it at once, and a reset or a clear the browser cannot store still applies, with one warning', async ({ page }) => {
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
    await page.getByRole('button', { name: 'Add...' }).click();
    await expect(page.getByTestId('popup-menu-filter-cognitive')).toBeVisible();
    await expect(page.getByTestId('popup-menu-filter-reachy')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Switched back on, it loads at once, and the study stays as it was.
    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await page.keyboard.press('Escape');
    await runPaletteCommand(page, /^Settings/);
    await page.getByRole('button', { name: 'Extensions' }).click();
    await page.getByRole('switch', { name: 'Load the Reachy Mini elements' }).click();
    await expect(page.getByRole('switch', { name: 'Load the Reachy Mini elements' })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Reload now' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('g[data-element-type="bpmn:Task"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Add...' }).click();
    await expect(page.getByTestId('popup-menu-filter-reachy')).toBeVisible();
    await page.keyboard.press('Escape');

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
