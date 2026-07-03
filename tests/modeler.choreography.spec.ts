import { expect, test } from '@playwright/test';

import {
  addPaletteElement,
  gotoModeler,
  readDownloadText,
  runPaletteCommand,
} from './utils';

/**
 * Choreography tasks: banded rendering (top/bottom participant bands with
 * initiator shading) and in-place band editing via double-click.
 */
test.describe('Studyflow choreography tasks', () => {
  test('creates a banded choreography task and edits participants in place', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Activities', 'Choreography Task', { x: 400, y: 240 });
    await expect(page.getByTestId('inspector-root')).toContainText('ChoreographyTask');

    // bpmn-js auto-opens name editing after create; its overlay covers the
    // bands, so dismiss it before double-clicking them.
    await page.keyboard.press('Escape');
    await expect(page.locator('.djs-direct-editing-content')).toBeHidden();

    const shape = page.locator('.djs-element[data-element-id^="ChoreographyTask_"]').first();
    const visual = shape.locator('.djs-visual');

    // Default participant bands render.
    await expect(visual).toContainText('Participant A');
    await expect(visual).toContainText('Participant B');

    // Initiator defaults to top: the top band keeps the fill, the bottom band is shaded.
    // (tests are typechecked without the DOM lib, hence the `any`)
    const bandFills = await visual.locator('path').evaluateAll(
      (paths) => paths.map((p: any) => p.style.fill || p.getAttribute('fill')),
    );
    expect(bandFills).toHaveLength(2);
    expect(bandFills[0]).not.toBe(bandFills[1]);

    // Double-click the TOP band -> edits topParticipant in place.
    // (x is offset from center so the clicks miss the selection's resize handles.)
    const box = (await shape.boundingBox())!;
    const bandX = box.x + box.width * 0.3;
    await page.mouse.dblclick(bandX, box.y + 8);
    const editor = page.locator('.djs-direct-editing-content');
    await expect(editor).toHaveText('Participant A');
    await editor.fill('Subject');
    await page.keyboard.press('Enter');
    await expect(visual).toContainText('Subject');

    // Double-click the BOTTOM band -> edits bottomParticipant in place.
    await page.mouse.dblclick(bandX, box.y + box.height - 8);
    await expect(editor).toHaveText('Participant B');
    await editor.fill('Experimenter');
    await page.keyboard.press('Enter');
    await expect(visual).toContainText('Experimenter');

    // Double-click the MIDDLE -> default behaviour still edits the task name.
    await page.mouse.dblclick(bandX, box.y + box.height / 2);
    await editor.fill('Give consent');
    await page.keyboard.press('Enter');
    await expect(visual).toContainText('Give consent');

    // Undo reverts the last edit through the command stack.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(visual).not.toContainText('Give consent');
    await expect(visual).toContainText('Subject');

    // A pure-choreography diagram saves with spec-clean BPMN containment:
    // a bpmn:Choreography root with declared participants and participant
    // references, not studyflow band attributes on a process.
    const downloadPromise = page.waitForEvent('download');
    await runPaletteCommand(page, 'Save As...', 'Studyflow...');
    const studyflowText = await readDownloadText(await downloadPromise);

    expect(studyflowText).toContain('type: bpmn:Choreography');
    expect(studyflowText).toContain('participantRef');
    expect(studyflowText).toContain('initiatingParticipantRef');
    expect(studyflowText).toContain('name: Subject');
    expect(studyflowText).not.toContain('topParticipant');
  });
});
