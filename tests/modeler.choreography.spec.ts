import { expect, test } from './e2e';

import { addPaletteElement, examplePath, exportDiagram, gotoModeler, labelEditor, readDownloadText } from './utils';

/**
 * Choreography tasks: who takes their bands, named in the inspector. A double click on a band edits it in place
 * (`packages/canvas/tests/choreography-bands.unit.spec.ts`), and the initiator's shading is canvas-render's.
 */
test('a choreography task names its two participants; a cognitive task names who takes it: a declared pool, a new actor, or no one', async ({ page }) => {
  await gotoModeler(page);
  const inspector = page.getByTestId('inspector-root');

  // From the palette, a choreography task arrives banded with two participants, and the inspector edits them.
  await addPaletteElement(page, 'Activities', 'Choreography Task', { x: 400, y: 240 });
  await expect(inspector).toContainText('ChoreographyTask');
  // The name editor opens on create; Escape closes it.
  await page.keyboard.press('Escape');
  await expect(labelEditor(page)).toBeHidden();
  const banded = page.locator('[data-element-id^="ChoreographyTask_"]').first();
  const topInput = inspector.locator('input[name="choreography:top"]');
  const bottomInput = inspector.locator('input[name="choreography:bottom"]');
  await expect(topInput).toHaveValue('Participant A');
  await expect(bottomInput).toHaveValue('Participant B');
  await topInput.fill('Learner');
  await topInput.press('Enter'); // the field is an editable select: text commits on Enter or blur
  await expect(banded).toContainText('Learner');
  await bottomInput.fill('Tutor');
  await bottomInput.press('Enter');
  await expect(banded).toContainText('Tutor');

  // A cognitive task presents itself; its one participant is an editable select, and a band-only actor is typed from there.
  // Its task draws plain: it answers along message flows. Its model's pool is a participant the band can name.
  await page.getByTestId('open-file-input').setInputFiles(examplePath('reachy_pools'));
  const shape = page.locator('[data-element-id="Play"]');
  await expect(shape).not.toContainText('Behaverse');
  await shape.click();
  const taker = inspector.locator('input[name="choreography:bottom"]');
  await expect(taker).toHaveValue('');
  await inspector.locator('button[aria-label="bottom participant choices"]').click();
  await page.getByRole('option', { name: /Model, gemma4 on Ollama/ }).click();
  await expect(taker).toHaveValue('Model, gemma4 on Ollama');
  await expect(shape).toContainText('Behaverse');
  // The presenting side is the task itself: no top band, no initiator to pick; the kind is the pool's.
  await expect(inspector.locator('input[name="choreography:top"]')).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: /initiating participant/i })).toHaveCount(0);
  await expect(inspector.getByTestId('choreography-bottom-kind')).toContainText(/language model/i);

  // Typing a new name makes an actor for this task; untyped, it reads as such.
  await taker.fill('Subject');
  await taker.press('Enter');
  await expect(shape).toContainText('Subject');
  await expect(inspector.getByTestId('choreography-bottom-kind')).toContainText(/untyped/i);

  // A band-only actor has no shape to select: its kind and that kind's settings are set here and reach the file.
  await inspector.getByRole('button', { name: /bottom participant kind/i }).click();
  await page.getByRole('option', { name: /^Software$/i }).click();
  await expect(inspector.getByTestId('choreography-bottom-kind')).toContainText(/software/i);
  const identifier = inspector.locator('input[name="studyflow:implementation"]');
  await identifier.fill('python://lab.bots.random');
  await identifier.blur();
  let studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(studyflowText).toContain('actorType: software');
  expect(studyflowText).toContain('implementation: python://lab.bots.random');

  // None clears the band: the task draws plain and the pool it sits in takes it.
  await inspector.locator('button[aria-label="bottom participant choices"]').click();
  await page.getByRole('option', { name: /^None$/i }).click();
  await expect(taker).toHaveValue('');
  await expect(shape).not.toContainText('Subject');
  await expect(shape).not.toContainText('Behaverse');

  // And back to the pool from the dropdown; the actor no band names any more has left the file.
  await inspector.locator('button[aria-label="bottom participant choices"]').click();
  await page.getByRole('option', { name: /Model, gemma4 on Ollama/ }).click();
  await expect(taker).toHaveValue('Model, gemma4 on Ollama');
  await expect(shape).toContainText('Behaverse');
  studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(studyflowText).toContain('- Pool_Model');
  expect(studyflowText).not.toContain('name: Subject');
});
