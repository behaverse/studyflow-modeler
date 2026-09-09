import { expect, test } from '@playwright/test';

import {
  addPaletteElement,
  expectEditorText,
  exportDiagram,
  gotoModeler,
  labelEditor,
  readDownloadText,
} from './utils';

/** Choreography tasks: banded rendering with initiator shading, and in-place band editing. */
test.describe('Studyflow choreography tasks', () => {
  test('creates a banded choreography task and edits participants in place', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Activities', 'Choreography Task', { x: 400, y: 240 });
    await expect(page.getByTestId('inspector-root')).toContainText('ChoreographyTask');

    // bpmn-js auto-opens name editing after create; its overlay covers the bands, so dismiss it first.
    await page.keyboard.press('Escape');
    await expect(labelEditor(page)).toBeHidden();

    const shape = page.locator('[data-element-id^="ChoreographyTask_"]').first();

    await expect(shape).toContainText('Participant A');
    await expect(shape).toContainText('Participant B');

    // (tests are typechecked without the DOM lib, hence the `any`)
    const bandFills = await shape.locator('path[data-band]').evaluateAll(
      (paths) => paths.map((p: any) => p.style.fill || p.getAttribute('fill')),
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

    const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));

    expect(studyflowText).toContain('type: Choreography');
    expect(studyflowText).toContain('participantRef');
    expect(studyflowText).toContain('initiatingParticipantRef');
    expect(studyflowText).toContain('messageFlows');
    expect(studyflowText).toContain('messageFlowRef');
    expect(studyflowText).toContain('name: Subject');
    expect(studyflowText).not.toContain('topParticipant');
  });

  test('participants are editable from the inspector', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Activities', 'Choreography Task', { x: 400, y: 240 });
    await page.keyboard.press('Escape');
    await expect(labelEditor(page)).toBeHidden();

    const inspector = page.getByTestId('inspector-root');
    const topInput = inspector.locator('input[name="choreography:top"]');
    const bottomInput = inspector.locator('input[name="choreography:bottom"]');
    await expect(topInput).toHaveValue('Participant A');
    await expect(bottomInput).toHaveValue('Participant B');

    const shape = page.locator('[data-element-id^="ChoreographyTask_"]').first();

    await topInput.fill('Subject');
    await topInput.press('Enter'); // the field is an editable select: text commits on Enter or blur
    await expect(shape).toContainText('Subject');
    await bottomInput.fill('Experimenter');
    await bottomInput.press('Enter');
    await expect(shape).toContainText('Experimenter');

    const bandFills = () => shape.locator('path[data-band]').evaluateAll(
      (paths) => paths.map((p: any) => p.style.fill || p.getAttribute('fill')),
    );
    const before = await bandFills();
    expect(before[0]).not.toBe(before[1]);

    await inspector.getByRole('button', { name: 'Initiating participant' }).click();
    await page.getByRole('option', { name: 'Experimenter' }).click();
    await expect.poll(bandFills).toEqual([before[1], before[0]]);
  });
});

/** A cognitive task presents itself; its one participant is an editable select, and a band-only actor is typed from there. */
test('a cognitive task names who takes it: a declared pool, a new actor, or no one', async ({ page }) => {
  const { exampleFile } = await import('./utils');
  await gotoModeler(page);
  await page.getByTestId('open-file-input').setInputFiles({
    name: 'reachy_participant.studyflow.png', mimeType: 'image/png', buffer: exampleFile('reachy_participant.studyflow.png'),
  });
  const shape = page.locator('[data-element-id="Play"]');
  await expect(shape).toContainText('Behaverse');
  await expect(shape).toContainText('Reachy Mini');
  await shape.click();
  const inspector = page.getByTestId('inspector-root');
  const taker = inspector.locator('input[name="choreography:bottom"]');
  await expect(taker).toHaveValue('Reachy Mini');
  // The presenting side is the task itself: no top band, no initiator to pick; the kind is the pool's.
  await expect(inspector.locator('input[name="choreography:top"]')).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: 'Initiating participant' })).toHaveCount(0);
  await expect(inspector.getByTestId('choreography-bottom-kind')).toContainText('Reachy Mini');

  // Typing a new name makes an actor for this task; untyped, it reads as such.
  await taker.fill('Subject');
  await taker.press('Enter');
  await expect(shape).toContainText('Subject');
  await expect(inspector.getByTestId('choreography-bottom-kind')).toContainText('Untyped');

  // A band-only actor has no shape to select: its kind and that kind's settings are set here and reach the file.
  await inspector.getByRole('button', { name: 'bottom participant kind' }).click();
  await page.getByRole('option', { name: 'Language model' }).click();
  await expect(inspector.getByTestId('choreography-bottom-kind')).toContainText('Language model');
  const identifier = inspector.locator('input[name="cognitive:identifier"]');
  await identifier.fill('claude:claude-haiku-4-5');
  await identifier.blur();
  let studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(studyflowText).toContain('actorType: llm');
  expect(studyflowText).toContain('identifier: claude:claude-haiku-4-5');

  // None clears the band: the task draws plain and the pool it sits in takes it; the unused actor leaves the file.
  await inspector.locator('button[aria-label="bottom participant choices"]').click();
  await page.getByRole('option', { name: 'None' }).click();
  await expect(taker).toHaveValue('');
  await expect(shape).not.toContainText('Subject');
  await expect(shape).not.toContainText('Behaverse');
  studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(studyflowText).not.toContain('name: Subject');

  // And back to the pool from the dropdown.
  await inspector.locator('button[aria-label="bottom participant choices"]').click();
  await page.getByRole('option', { name: /Reachy Mini/ }).click();
  await expect(taker).toHaveValue('Reachy Mini');
  await expect(shape).toContainText('Behaverse');
  studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
  expect(studyflowText).toContain('- Pool_Reachy');
});
