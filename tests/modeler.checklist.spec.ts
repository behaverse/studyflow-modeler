import { expect, test } from '@playwright/test';

import { addPaletteElement, gotoModeler } from './utils';

test('Enter in a checklist item adds the next one and moves the cursor into it', async ({ page }) => {
  await gotoModeler(page);
  await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
  await page.getByRole('tab', { name: /documentation/i }).click();

  // The field's label names every item's textbox, so the items are told apart by position.
  const items = page.getByRole('textbox', { name: /^Checklist / });
  await page.getByRole('button', { name: /add checklist item/i }).click();
  await expect(items.first()).toBeFocused();
  await items.first().fill('consent');
  await items.first().press('Enter');

  await expect(items).toHaveCount(2);
  await expect(items.nth(1)).toBeFocused();
});
