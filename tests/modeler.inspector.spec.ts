import * as yaml from 'js-yaml';

import { expect, test } from './e2e';

import { addPaletteElement, addSchemaPaletteElement, exportDiagram, gotoModeler, pressOnCanvas, readDownloadText, runPaletteCommand, setSelectedElementName } from './utils';

test("inspector fields: an optional one opens when ticked and clears unticked, a name is drawn, Enter in a checklist adds the next item and a tick checks it off in the Checklist view, and a many-valued enum's tick is stored", async ({ page }) => {
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

  // A ticked item is checked off in the study, where the Checklist view gathers every element's list.
  await items.nth(1).fill('debrief');
  await inspector.getByRole('checkbox', { name: 'Check consent' }).check();
  await runPaletteCommand(page, 'View as Checklist...');
  const view = page.getByRole('dialog');
  await expect(view).toContainText('Review Task');
  await expect(view).toContainText('1 of 2 items complete.');
  await expect(view.getByRole('checkbox', { name: 'consent' })).toBeChecked();
  await expect(view.getByRole('checkbox', { name: 'debrief' })).not.toBeChecked();
  await page.keyboard.press('Escape');

  // A many-valued enum is a checkbox per literal, and a tick lands in the study.
  await addSchemaPaletteElement(page, 'Reachy Mini', 'Interaction Recording', { x: 340, y: 380 });
  await page.keyboard.press('Escape');
  await inspector.getByRole('tab', { name: 'Reachy Mini' }).click();
  await inspector.getByRole('checkbox', { name: 'Audio' }).check();
  const study = yaml.load(await readDownloadText(await exportDiagram(page, 'studyflow'))) as any;
  const recording = Object.values<any>(study.Study_1.flowElements).find((element) => element.type === 'reachy:InteractionRecording');
  expect(recording.streams).toEqual(['audio']);
});

test("the code modals: a schema's columns are saved as the table is left, in the format picked, which the schema then names, and a script's code in the language picked; each modal's save is one undo step", async ({ page }) => {
  await gotoModeler(page);
  const inspector = page.getByTestId('inspector-root');
  const dialog = page.getByRole('dialog');

  await addSchemaPaletteElement(page, 'Core', 'Schema', { x: 340, y: 180 });
  await page.keyboard.press('Escape');
  await addPaletteElement(page, 'Activities', 'Script', { x: 340, y: 380 });
  await page.keyboard.press('Escape');
  await inspector.getByRole('tab', { name: 'Execution' }).click();
  await inspector.getByRole('button', { name: /^Edit / }).click();
  await dialog.getByRole('combobox').selectOption('python');
  await dialog.locator('textarea').fill('print(42)');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByTestId('modeler-canvas').click({ position: { x: 340, y: 180 } });
  await inspector.getByRole('tab', { name: 'Data' }).click();
  await inspector.getByRole('button', { name: 'Edit columns' }).click();
  await expect(dialog.getByRole('radio', { name: 'CSVW JSON-LD' })).toBeChecked();
  // Three columns, the last moved up past the second and the first removed.
  for (const name of ['rt', 'trial', 'acc']) {
    await dialog.getByRole('button', { name: '+ Add column' }).click();
    await dialog.getByPlaceholder('column_name').last().fill(name);
  }
  await dialog.getByRole('combobox').last().selectOption('number');
  await dialog.getByTitle('Move up').last().click();
  await dialog.getByTitle('Remove column').first().click();
  await dialog.getByRole('radio', { name: 'LinkML YAML' }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  const exported = async () => {
    const elements = Object.values<any>((yaml.load(await readDownloadText(await exportDiagram(page, 'studyflow'))) as any).Study_1.flowElements);
    return { schema: elements.find((element) => element.type === 'studyflow:Schema'), script: elements.find((element) => element.type === 'ScriptTask') };
  };
  let { schema, script } = await exported();
  expect(schema.format).toBe('linkml');
  // A YAML body is spelled as YAML in the file, as the modeler writes it.
  expect(Object.entries(schema.body.classes.TableRow.attributes)).toEqual([['acc', { range: 'number' }], ['trial', { range: 'string' }]]);
  expect(script).toMatchObject({ scriptFormat: 'python', script: 'print(42)' });

  // A modal saves what it edits as one edit, the columns and their format, the code and its language: an undo per
  // modal takes back each whole, the stamp the save left with the last (`provenance/trail.ts`).
  for (let i = 0; i < 2; i++) await pressOnCanvas(page, 'ControlOrMeta+z');
  ({ schema, script } = await exported());
  expect([schema.format, schema.body, script.script, script.scriptFormat]).toEqual([undefined, undefined, undefined, undefined]);
});
