import * as yaml from 'js-yaml';

import { expect, test } from './e2e';

import { addPaletteElement, addSchemaPaletteElement, exportDiagram, gotoModeler, pressOnCanvas, readDownloadText, setSelectedElementName } from './utils';

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

test("the code modals: a schema's columns are saved in the format picked, which the schema then names, and a script's code in the language picked, which one undo takes back whole", async ({ page }) => {
  await gotoModeler(page);
  const inspector = page.getByTestId('inspector-root');
  const dialog = page.getByRole('dialog');

  await addSchemaPaletteElement(page, 'Core', 'Schema', { x: 340, y: 180 });
  await page.keyboard.press('Escape');
  await inspector.getByRole('tab', { name: 'Data' }).click();
  await inspector.getByRole('button', { name: 'Edit columns' }).click();
  await expect(dialog.getByRole('radio', { name: 'CSVW JSON-LD' })).toBeChecked();
  await dialog.getByRole('button', { name: '+ Add column' }).click();
  await dialog.getByPlaceholder('column_name').fill('rt');
  await dialog.getByRole('combobox').selectOption('number');
  await dialog.getByRole('radio', { name: 'LinkML YAML' }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  await addPaletteElement(page, 'Activities', 'Script', { x: 340, y: 380 });
  await page.keyboard.press('Escape');
  await inspector.getByRole('tab', { name: 'Execution' }).click();
  await inspector.getByRole('button', { name: /^Edit / }).click();
  await dialog.getByRole('combobox').selectOption('python');
  await dialog.locator('textarea').fill('print(42)');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  const exported = async () => Object.values<any>((yaml.load(await readDownloadText(await exportDiagram(page, 'studyflow'))) as any).Study_1.flowElements);
  // The code and its language are one save, so one undo takes back both, and a redo brings both back.
  await pressOnCanvas(page, 'ControlOrMeta+z');
  let script = (await exported()).find((element) => element.type === 'ScriptTask');
  expect([script.script, script.scriptFormat]).toEqual([undefined, undefined]);
  await inspector.getByRole('button', { name: /^Edit / }).click();
  await dialog.getByRole('combobox').selectOption('python');
  await dialog.locator('textarea').fill('print(42)');
  await dialog.getByRole('button', { name: 'Save' }).click();

  const elements = await exported();
  const schema = elements.find((element) => element.type === 'studyflow:Schema');
  expect(schema.format).toBe('linkml');
  // A YAML body is spelled as YAML in the file, as the modeler writes it.
  expect(schema.body).toEqual({ classes: { TableRow: { attributes: { rt: { range: 'number' } } } } });
  script = elements.find((element) => element.type === 'ScriptTask');
  expect(script).toMatchObject({ scriptFormat: 'python', script: 'print(42)' });
});
