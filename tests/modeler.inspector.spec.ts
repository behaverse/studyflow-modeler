import { expect, test } from '@playwright/test';

import { gotoModeler } from './utils';

test('an optional field opens when ticked, keeps what is typed into it, and unticking clears it', async ({ page }) => {
  await gotoModeler(page);
  const inspector = page.getByTestId('inspector-root');
  const toggle = inspector.getByRole('checkbox', { name: 'Version' });
  const field = inspector.locator('input[name="studyflow:version"]');

  // Ticked and not yet typed into, the study holds no version, and the field stays open.
  await toggle.click();
  await expect(toggle).toBeChecked();
  await field.fill('1.2');
  await expect(field).toHaveValue('1.2');

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(field).toHaveCount(0);
});
