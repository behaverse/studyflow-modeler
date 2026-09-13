import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import {
  addPaletteElement,
  addSchemaPaletteElement,
  exportDiagram,
  extractStudyflowFromSvg,
  gotoModeler,
  pressOnCanvas,
  readDownloadText,
  setSelectedElementName,
} from './utils';

test.describe('Studyflow modeler palette flows', () => {
  test('adds palette items, names a task, and keeps exported outputs in sync', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Events', 'Start', { x: 140, y: 160 });
    await expect(page.getByTestId('inspector-root')).toContainText('StartEvent');

    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await expect(page.getByTestId('inspector-root')).toContainText('Task');

    await setSelectedElementName(page, 'Review Task');
    await expect(page.getByTestId('modeler-canvas')).toContainText('Review Task');

    // A schema's flyout adds its elements: a Rest is a task that carries `cognitive:Rest`.
    await addSchemaPaletteElement(page, 'Cognitive', 'Rest', { x: 540, y: 180 });

    const svgDownload = await exportDiagram(page, 'svg');
    expect(svgDownload.suggestedFilename()).toBe('diagram.studyflow.svg');
    const studyflowText = await readDownloadText(await exportDiagram(page, 'studyflow'));
    expect(studyflowText).toContain('name: Review Task');
    expect(studyflowText).toMatch(/type: Task\n\s+extensionElements:\n\s+- type: cognitive:Rest\n/);
    // The picture carries the .studyflow.yaml itself.
    expect(extractStudyflowFromSvg(await readDownloadText(svgDownload))).toBe(studyflowText);
  });

  test('a template arrives collapsed with its flow inside, keeps its ids where they are free, and a second drop rewrites its own references', async ({ page }) => {
    await gotoModeler(page);

    await addSchemaPaletteElement(page, 'Agentic', 'Evaluator-optimizer', { x: 300, y: 200 });
    await addSchemaPaletteElement(page, 'Agentic', 'Evaluator-optimizer', { x: 300, y: 420 });

    const doc = yaml.load(await readDownloadText(await exportDiagram(page, 'studyflow'))) as Record<string, any>;
    const process = Object.values(doc).find((value) => value?.type === 'Process');
    const [first, second] = Object.values(process.flowElements).filter((el: any) => el.type === 'SubProcess') as any[];

    // A subprocess template arrives collapsed, with its flow inside where the template drew it,
    // each flow keeping its name and condition.
    expect(first.isExpanded).toBe(false);
    const inner = Object.values(first.flowElements) as any[];
    expect(inner.map((el) => el.name)).toEqual(expect.arrayContaining(['Draft', 'Judge the draft', 'Good enough?', 'revise']));
    expect(inner.find((el) => el.name === 'revise').conditionExpression).toContain('score < 4');
    expect(inner.find((el) => el.name === 'Draft').bounds).toBe('200 140 100 80');
    const gateOf = (sub: any) => Object.keys(sub.flowElements).find((id) => sub.flowElements[id].name === 'Good enough?')!;
    const guardOf = (sub: any) => (Object.values(sub.flowElements) as any[]).find((el) => el.name === 'revise').conditionExpression;

    expect(gateOf(first)).toBe('eo_gate');
    expect(guardOf(first)).toContain("state.trace.count('eo_gate')");
    const gate = gateOf(second);
    expect(gate).toMatch(/^eo_gate_/);
    expect(guardOf(second)).toContain(`state.trace.count('${gate}')`);

    // Once the copy holding them is deleted, the template's own ids are free again.
    await page.locator('g[data-element-id="Evaluator_optimizer"]').click();
    await pressOnCanvas(page, 'Delete');
    await addSchemaPaletteElement(page, 'Agentic', 'Evaluator-optimizer', { x: 300, y: 200 });
    const after = yaml.load(await readDownloadText(await exportDiagram(page, 'studyflow'))) as Record<string, any>;
    const subs = Object.values(Object.values(after).find((value: any) => value?.type === 'Process').flowElements)
      .filter((el: any) => el.type === 'SubProcess') as any[];
    expect(subs.map(gateOf).sort()).toEqual(['eo_gate', gate]);
  });
});
