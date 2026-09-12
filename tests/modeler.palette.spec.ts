import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';

import { xmlToStudyflow } from '@core/document';
import { fromModdleYaml, toModdlePackages } from '@core/notation/schemaFile';
import { SCHEMAS, schemaSource } from './schemas';
import {
  addPaletteElement,
  addSchemaPaletteElement,
  exportDiagram,
  extractStudyflowFromSvg,
  gotoModeler,
  normalizeXml,
  pressOnCanvas,
  readDownloadText,
  setSelectedElementName,
} from './utils';

async function toYaml(xml: string): Promise<string> {
  const models = SCHEMAS.map(({ prefix }) => fromModdleYaml(schemaSource(prefix)));
  const packages = Object.fromEntries(models.map((m) => [m.prefix, toModdlePackages(m, models)]));
  return xmlToStudyflow(xml, new BpmnModdle(packages));
}

test.describe('Studyflow modeler palette flows', () => {
  test('adds palette items, names a task, and keeps exported outputs in sync', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Events', 'Start', { x: 140, y: 160 });
    await expect(page.getByTestId('inspector-root')).toContainText('StartEvent');

    await addPaletteElement(page, 'Activities', 'Task', { x: 340, y: 180 });
    await expect(page.getByTestId('inspector-root')).toContainText('Task');

    await setSelectedElementName(page, 'Review Task');
    await expect(page.getByTestId('modeler-canvas')).toContainText('Review Task');


    const svgDownload = await exportDiagram(page, 'svg');
    const svgText = await readDownloadText(svgDownload);

    expect(svgDownload.suggestedFilename()).toBe('diagram.studyflow.svg');
    expect(svgText).toContain('Review Task');
    expect(svgText).toContain('<studyflow>');

    const embeddedStudyflow = extractStudyflowFromSvg(svgText);
    const normalizedEmbeddedStudyflow = normalizeXml(embeddedStudyflow);
    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:task\b/);
    expect(normalizedEmbeddedStudyflow).toContain('name="Review Task"');
    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:startEvent\b/);

    const studyflowDownload = await exportDiagram(page, 'studyflow');
    const studyflowText = await readDownloadText(studyflowDownload);

    expect(studyflowDownload.suggestedFilename()).toBe('diagram.studyflow.yaml');
    expect(studyflowText.startsWith('id:')).toBe(true);
    expect(studyflowText).toContain('name: Review Task');
    expect(studyflowText).toBe(await toYaml(embeddedStudyflow));
  });

  test('adds a schema-backed cognitive element and preserves pinned defaults', async ({ page }) => {
    await gotoModeler(page);

    await addPaletteElement(page, 'Events', 'Start', { x: 120, y: 160 });
    await addSchemaPaletteElement(page, 'Behaverse', 'Task', { x: 320, y: 180 });


    const svgDownload = await exportDiagram(page, 'svg');
    const embeddedStudyflow = extractStudyflowFromSvg(await readDownloadText(svgDownload));
    const normalizedEmbeddedStudyflow = normalizeXml(embeddedStudyflow);

    // behaverse:Task's pinned default (instrument="behaverse") stays implicit in the schema, not serialized onto the element.
    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:task\b/);
    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:startEvent\b/);
    expect(normalizedEmbeddedStudyflow).toContain('<behaverse:task');

    const studyflowDownload = await exportDiagram(page, 'studyflow');
    const studyflowText = await readDownloadText(studyflowDownload);

    expect(studyflowText).toContain('type: behaverse:Task');
    expect(studyflowText).toContain('instrument: behaverse');
    expect(studyflowText).toBe(await toYaml(embeddedStudyflow));
  });

  test('a participant template arrives with its flow, not as an empty pool', async ({ page }) => {
    // `eeg:Session` extends `bpmn:Participant`, and a blank diagram's root plane is a
    // `bpmn:Process`, which can never contain a pool. Both backends therefore PROMOTE
    // the root on this drop — mint a `bpmn:Collaboration`, point the pool at the
    // process the plane used to depict, re-point the BPMNPlane. bpmn-js does it in
    // `CreateParticipantBehavior` + `UpdateCanvasRootBehavior`; the canvas does it in
    // `Writeback.promoteRootToCollaboration` (P6b §3A).
    await gotoModeler(page);

    await addSchemaPaletteElement(page, 'EEG & Biosignals', 'EEG session', { x: 420, y: 300 });

    const studyflowDownload = await exportDiagram(page, 'studyflow');
    const studyflowText = await readDownloadText(studyflowDownload);

    expect(studyflowText).toContain('type: eeg:Session');
    expect(studyflowText).toContain('Mount cap & check impedance');
    expect(studyflowText).toContain('type: cognitive:Rest');
    expect(studyflowText).toContain('type: cognitive:CognitiveTask');
  });

  test('a subprocess template arrives collapsed with its flow inside, flows keeping their names and conditions', async ({ page }) => {
    await gotoModeler(page);

    await addSchemaPaletteElement(page, 'Agentic', 'Evaluator-optimizer', { x: 420, y: 300 });

    const doc = yaml.load(await readDownloadText(await exportDiagram(page, 'studyflow'))) as Record<string, any>;
    const process = Object.values(doc).find((value) => value?.type === 'Process');
    const sub = Object.values(process.flowElements).find((el: any) => el.type === 'SubProcess') as any;
    expect(sub.isExpanded).toBe(false);
    const inner = Object.values(sub.flowElements) as any[];
    expect(inner.map((el) => el.name)).toEqual(expect.arrayContaining(['Draft', 'Judge the draft', 'Good enough?', 'revise']));
    expect(inner.find((el) => el.name === 'revise').conditionExpression).toContain('score < 4');
    expect(inner.find((el) => el.name === 'Draft').bounds).toBe('200 140 100 80');
  });

  test('a template keeps its ids where they are free, and a second drop rewrites its own references', async ({ page }) => {
    await gotoModeler(page);

    await addSchemaPaletteElement(page, 'Agentic', 'Evaluator-optimizer', { x: 300, y: 200 });
    await addSchemaPaletteElement(page, 'Agentic', 'Evaluator-optimizer', { x: 300, y: 420 });

    const doc = yaml.load(await readDownloadText(await exportDiagram(page, 'studyflow'))) as Record<string, any>;
    const process = Object.values(doc).find((value) => value?.type === 'Process');
    const [first, second] = Object.values(process.flowElements).filter((el: any) => el.type === 'SubProcess') as any[];
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

  test('applies default schema values for eeg EEGPrep elements', async ({ page }) => {
    await gotoModeler(page);

    await addSchemaPaletteElement(page, 'EEG & Biosignals', 'EEGPrep', { x: 260, y: 200 });

    const studyflowDownload = await exportDiagram(page, 'studyflow');
    const studyflowText = await readDownloadText(studyflowDownload);

    // EEGPrep is a template, not a type: a service task bound to the preprocessing tool.
    expect(studyflowText).toContain('type: ServiceTask');
    expect(studyflowText).toContain('name: EEGPrep');
    expect(studyflowText).toContain('implementation: docker://sccn/eegprep');
    expect(studyflowText).toContain('asr_criterion: 20');
  });
});
