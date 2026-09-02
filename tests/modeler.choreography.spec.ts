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
    await expect(shape).toContainText('Subject');
    await bottomInput.fill('Experimenter');
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
