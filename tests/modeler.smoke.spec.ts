import { expect, test } from '@playwright/test';

import { SCHEMAS } from './schemas';
import { gotoModeler, openCommandPalette, runPaletteCommand } from './utils';

test.describe('Studyflow modeler smoke', () => {
  test('loads the modeler shell, whose Gantt and Settings views open from the command palette', async ({ page }) => {
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

    // Settings lists every schema the app loads, each a switch, a required one locked on.
    await runPaletteCommand(page, /^Settings/);
    await page.getByText(/^Extensions$/).first().click();
    for (const schema of SCHEMAS) {
      const toggle = page.getByRole('switch', { name: new RegExp(`\\b${schema.name}\\b`) });
      await expect(toggle).toBeAttached();
      if (schema.required) await expect(toggle).toBeDisabled();
    }
    await expect(page.getByRole('img', { name: /required/i }))
      .toHaveCount(SCHEMAS.filter((schema) => schema.required).length);
  });
});
