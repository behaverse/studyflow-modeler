import { expect, test } from './e2e';

import { addPaletteElement, gotoModeler, setSelectedElementName } from './utils';

test('inspector fields: an optional one opens when ticked and clears unticked, a name is drawn, and Enter in a checklist adds the next item', async ({ page }) => {
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

  await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
  await setSelectedElementName(page, 'Review Task');
  await expect(page.getByTestId('modeler-canvas')).toContainText('Review Task');

  // The field's label names every item's textbox, so the items are told apart by position.
  await page.getByRole('tab', { name: /documentation/i }).click();
  const items = page.getByRole('textbox', { name: /^Checklist / });
  await page.getByRole('button', { name: /add checklist item/i }).click();
  await expect(items.first()).toBeFocused();
  await items.first().fill('consent');
  await items.first().press('Enter');

  await expect(items).toHaveCount(2);
  await expect(items.nth(1)).toBeFocused();
});
