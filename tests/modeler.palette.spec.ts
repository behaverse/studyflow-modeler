import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { xmlToStudyflow } from '@core/document';
import { fromModdleYaml, toModdlePackages } from '@core/notation/schemaFile';
import { SCHEMAS } from './schemas';
import {
  addPaletteElement,
  addSchemaPaletteElement,
  exportDiagram,
  extractStudyflowFromSvg,
  gotoModeler,
  normalizeXml,
  readDownloadText,
  setSelectedElementName,
  stubIconify,
} from './utils';

async function toYaml(xml: string): Promise<string> {
  const schemaDir = path.join(process.cwd(), 'assets/schemas');
  const models = SCHEMAS.map(({ prefix }) =>
    fromModdleYaml(readFileSync(path.join(schemaDir, `${prefix}.moddle.yaml`), 'utf8')),
  );
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

    await stubIconify(page);

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
    await addSchemaPaletteElement(page, 'Cognitive', 'Behaverse Task', { x: 320, y: 180 });

    await stubIconify(page);

    const svgDownload = await exportDiagram(page, 'svg');
    const embeddedStudyflow = extractStudyflowFromSvg(await readDownloadText(svgDownload));
    const normalizedEmbeddedStudyflow = normalizeXml(embeddedStudyflow);

    // BehaverseTask's pinned default (instrument="behaverse") stays implicit in the schema, not serialized onto the element.
    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:task\b/);
    expect(normalizedEmbeddedStudyflow).toMatch(/<[A-Za-z0-9_]+:startEvent\b/);
    expect(normalizedEmbeddedStudyflow).toContain('<cognitive:behaverseTask');

    const studyflowDownload = await exportDiagram(page, 'studyflow');
    const studyflowText = await readDownloadText(studyflowDownload);

    expect(studyflowText).toContain('type: cognitive:BehaverseTask');
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

    await addSchemaPaletteElement(page, 'EEG', 'EEG session', { x: 420, y: 300 });

    const studyflowDownload = await exportDiagram(page, 'studyflow');
    const studyflowText = await readDownloadText(studyflowDownload);

    expect(studyflowText).toContain('type: eeg:Session');
    expect(studyflowText).toContain('Mount cap & check impedance');
    expect(studyflowText).toContain('type: cognitive:Rest');
    expect(studyflowText).toContain('type: cognitive:CognitiveTask');
  });

  test('applies default schema values for eeg EEGPrep elements', async ({ page }) => {
    await gotoModeler(page);

    await addSchemaPaletteElement(page, 'EEG', 'EEGPrep', { x: 260, y: 200 });

    const studyflowDownload = await exportDiagram(page, 'studyflow');
    const studyflowText = await readDownloadText(studyflowDownload);

    // EEGPrep is a template, not a type: a service task bound to the preprocessing tool.
    expect(studyflowText).toContain('type: ServiceTask');
    expect(studyflowText).toContain('name: EEGPrep');
    expect(studyflowText).toContain('implementation: docker://sccn/eegprep');
    expect(studyflowText).toContain('asr_criterion: 20');
  });
});
