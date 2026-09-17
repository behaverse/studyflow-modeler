import { expect, test } from '@playwright/test';

import {
  addPaletteElement,
  examplePath,
  expectEditorText,
  exportDiagram,
  gotoModeler,
  labelEditor,
  readDownloadText,
} from './utils';

/** Choreography tasks: banded rendering with initiator shading, and in-place band editing. */
test.describe('Studyflow choreography tasks', () => {
  test('creates a banded choreography task and edits its participants in place and from the inspector', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Activities', 'Choreography Task', { x: 400, y: 240 });
    await expect(page.getByTestId('inspector-root')).toContainText('ChoreographyTask');

    // The name editor opens on create; its overlay covers the bands, so dismiss it first.
    await page.keyboard.press('Escape');
    await expect(labelEditor(page)).toBeHidden();

    const shape = page.locator('[data-element-id^="ChoreographyTask_"]').first();

    await expect(shape).toContainText('Participant A');
    await expect(shape).toContainText('Participant B');

    const bandFills = await shape.locator('path[data-band]').evaluateAll(
      (paths) => paths.map((p) => (p as SVGPathElement).style.fill || p.getAttribute('fill')),
    );
    expect(bandFills).toHaveLength(2);
    expect(bandFills[0]).not.toBe(bandFills[1]);

    const box = (await shape.boundingBox())!;
    const bandX = box.x + box.width * 0.3;
    await page.mouse.dblclick(bandX, box.y + 8);
    const editor = labelEditor(page);
    await expectEditorText(page, 'Participant A');
    await editor.fill('Subject');
    await page.keyboard.press('Enter');
    await expect(shape).toContainText('Subject');

    await page.mouse.dblclick(bandX, box.y + box.height - 8);
    await expectEditorText(page, 'Participant B');
    await editor.fill('Experimenter');
    await page.keyboard.press('Enter');
    await expect(shape).toContainText('Experimenter');

    await page.mouse.dblclick(bandX, box.y + box.height / 2);
    await editor.fill('Give consent');
    await page.keyboard.press('Enter');
    await expect(shape).toContainText('Give consent');

    await expect(editor).toBeHidden();
    await expect(page.getByTestId('modeler-canvas').locator('svg[tabindex]')).toBeFocused();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(shape).not.toContainText('Give consent');
    await expect(shape).toContainText('Subject');

    // The inspector edits the same two participants.
    const inspector = page.getByTestId('inspector-root');
    const topInput = inspector.locator('input[name="choreography:top"]');
    const bottomInput = inspector.locator('input[name="choreography:bottom"]');
    await expect(topInput).toHaveValue('Subject');
    await expect(bottomInput).toHaveValue('Experimenter');
    await topInput.fill('Learner');
    await topInput.press('Enter'); // the field is an editable select: text commits on Enter or blur
    await expect(shape).toContainText('Learner');
    await bottomInput.fill('Tutor');
    await bottomInput.press('Enter');
    await expect(shape).toContainText('Tutor');
  });
});

/** A cognitive task presents itself; its one participant is an editable select, and a band-only actor is typed from there. */
test('a cognitive task names who takes it: a declared pool, a new actor, or no one', async ({ page }) => {
  await gotoModeler(page);
  // Its task draws plain: it answers along message flows. Its model's pool is a participant the band can name.
  await page.getByTestId('open-file-input').setInputFiles(examplePath('reachy_pools'));
  const shape = page.locator('[data-element-id="Play"]');
  await expect(shape).not.toContainText('Behaverse');
  await shape.click();
  const inspector = page.getByTestId('inspector-root');
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
