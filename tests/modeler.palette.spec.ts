import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { extractStudyflowFromSvg } from '@core/document/svg';

import { loadSchemaModels } from './schemas';
import {
  addPaletteElement,
  addSchemaPaletteElement,
  exportDiagram,
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
    // The picture carries the diagram as BPMN XML, nested in its metadata.
    const bpmn = extractStudyflowFromSvg(await readDownloadText(svgDownload));
    expect(bpmn).toMatch(/^<(\w+:)?definitions /);
    expect(bpmn).toContain('name="Review Task"');
  });

  test('a template arrives collapsed with its flow inside, keeps its ids where they are free, and a second drop rewrites its own references', async ({ page }) => {
    await gotoModeler(page);

    await addSchemaPaletteElement(page, 'Reachy Mini', 'Conversation', { x: 300, y: 200 });
    await addSchemaPaletteElement(page, 'Reachy Mini', 'Conversation', { x: 300, y: 420 });

    const doc = yaml.load(await readDownloadText(await exportDiagram(page, 'studyflow'))) as Record<string, any>;
    const process = Object.values(doc).find((value) => value?.type === 'Process');
    const [first, second] = Object.values(process.flowElements).filter((el: any) => el.type === 'SubProcess') as any[];

    // A subprocess template arrives collapsed, with its flow inside where the template drew it.
    expect(first.isExpanded).toBe(false);
    const inner = Object.values(first.flowElements) as any[];
    expect(inner.map((el) => el.name)).toEqual(expect.arrayContaining(['Listen', 'Heard', 'Ask the model', 'Reply', 'Say the reply']));
    // Where the template drew it: the bounds its schema spells for that step.
    const template = loadSchemaModels().flatMap((model) => model.templates ?? []).find((t) => t.elements?.Conversation)!;
    const drawn = Object.values(template.elements!.Conversation.flowElements as Record<string, any>).find((el) => el.name === 'Listen')!;
    expect(inner.find((el) => el.name === 'Listen').bounds).toBe(drawn.bounds);
    const heardOf = (sub: any) => Object.keys(sub.flowElements).find((id) => sub.flowElements[id].name === 'Heard')!;
    const loopOf = (sub: any) => sub.loopCharacteristics.loopCondition;

    // Its loop condition names its own data object, and follows it when a second drop renames it.
    expect(heardOf(first)).toBe('Heard');
    expect(loopOf(first)).toContain('(Heard or');
    const heard = heardOf(second);
    expect(heard).toMatch(/^Heard_/);
    expect(loopOf(second)).toContain(`(${heard} or`);

    // Once the copy holding them is deleted, the template's own ids are free again.
    await page.locator('g[data-element-id="Conversation"]').click();
    await pressOnCanvas(page, 'Delete');
    await addSchemaPaletteElement(page, 'Reachy Mini', 'Conversation', { x: 300, y: 200 });
    const after = yaml.load(await readDownloadText(await exportDiagram(page, 'studyflow'))) as Record<string, any>;
    const subs = Object.values(Object.values(after).find((value: any) => value?.type === 'Process').flowElements)
      .filter((el: any) => el.type === 'SubProcess') as any[];
    expect(subs.map(heardOf).sort()).toEqual(['Heard', heard]);
  });
});
