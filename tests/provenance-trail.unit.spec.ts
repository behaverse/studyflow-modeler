import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '@core/notation';
import { inferPlaneRoot, readState, studyflowToXml, writeState, xmlToStudyflow } from '@core/document';
import { toModdlePackages } from '@core/notation/schemaFile';
import {
  appendTrailEntry,
  primaryRoot,
  readTrail,
  resetTrailStamping,
  stampTrailForExport,
  trailTimestamp,
} from '@modeler/provenance/trail';
import { loadSchemaModels } from './schemas';
import { exampleXml } from './utils';
import type { Editor } from '@modeler/editor/port';

/** Run records in `state._meta.prov`, stamped once per *fact* so re-rendering stays byte-stable. */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const moddle = new BpmnModdle(packages) as any;

async function definitionsOf(xml: string): Promise<any> {
  const { rootElement } = await moddle.fromXML(xml);
  return rootElement;
}

/** Shipped examples may already carry a trail (rendering stamps them); build premises from one with none. */
function stripTrail(definitions: any): any {
  const root = primaryRoot(definitions);
  const ext = root.extensionElements;
  if (ext) ext.values = ext.values.filter((value: any) => value.$type !== 'prov:Activity');
  const tree = readState(definitions);
  delete tree._meta?.prov;
  writeState(definitions, moddle, tree);
  return definitions;
}

test.describe('provenance trail', () => {
  test('appends an entry that survives the XML round trip', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));

    appendTrailEntry(definitions, moddle, {
      action: 'modified',
      when: '2026-07-31T09:12:04Z',
      who: 'someone@example.org',
      with: 'studyflow-modeler/26.0731',
    });

    const { xml } = await moddle.toXML(definitions, { format: true });
    expect(xml).toContain('<studyflow:state>');
    expect(primaryRoot(definitions).extensionElements.values.some((v: any) => v.$type === 'prov:Activity')).toBe(false);
    expect(readState(definitions)._meta.prov).toHaveLength(1);

    const trail = readTrail(await definitionsOf(xml));
    expect(trail).toHaveLength(1);
    expect(trail[0].action).toBe('modified');
    expect(trail[0].when).toBe('2026-07-31T09:12:04Z');
    expect(trail[0].who).toBe('someone@example.org');
    expect(trail[0].with).toBe('studyflow-modeler/26.0731');
  });

  test('survives the `.studyflow.yaml` round trip', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    appendTrailEntry(definitions, moddle, {
      action: 'created',
      when: trailTimestamp(new Date('2026-07-31T10:00:00Z')),
      with: 'studyflow-modeler/26.0731',
    });
    const { xml } = await moddle.toXML(definitions, { format: true });

    const yaml = await xmlToStudyflow(xml, moddle);
    expect(yaml).toMatch(/^state:\n/m);
    const reloaded = readTrail(await definitionsOf(await studyflowToXml(yaml, moddle)));

    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].action).toBe('created');
    // The stamp is written in the machine's own timezone; assert the instant and offset shape, not one rendering.
    expect(Date.parse(reloaded[0].when)).toBe(Date.parse('2026-07-31T10:00:00Z'));
    expect(reloaded[0].when).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
    expect(reloaded[0].who).toBeUndefined();
  });

  test('stamps once per fact, not once per download', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('drawn_loop.studyflow.png')));
    // A partial mock: stamping reads the document and `moddle`, and decides off the
    // revision counter `editor/history.ts` serves, one bump per applied mutation.
    // `edit()` is that bump.
    let revision = 0;
    const modeler = {
      getDefinitions: () => definitions,
      revision: () => revision,
      model: { moddle: () => moddle },
    } as unknown as Editor;
    const edit = () => { revision += 1; };

    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })?.action).toBe('created');
    expect(readTrail(definitions)).toHaveLength(1);

    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })).toBeUndefined();
    expect(readTrail(definitions)).toHaveLength(1);

    edit();
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })?.action).toBe('modified');
    expect(readTrail(definitions)).toHaveLength(2);
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })).toBeUndefined();

    // Reopened (import resets the edit history without moving the revision): a trail-carrying document nobody edits is left untouched.
    resetTrailStamping(modeler);
    expect(stampTrailForExport(modeler, { tool: 'studyflow-modeler/test' })).toBeUndefined();
    expect(readTrail(definitions)).toHaveLength(2);
  });

  test('reads the drawn root, and omits unset facts from the entry', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('agent_eval_pool.studyflow.png')));
    const root = primaryRoot(definitions);
    expect(root.id).toBe(definitions.diagrams[0].plane.bpmnElement.id);

    const entry = appendTrailEntry(definitions, moddle, {
      action: 'imported',
      when: '2026-07-31T11:00:00Z',
      who: undefined,
      with: 'studyflow-modeler/26.0731',
    });
    expect(entry?.who).toBeUndefined();
    expect(readTrail(definitions)).toHaveLength(1);
  });
});

test.describe('primary root agrees with the codec', () => {
  const poolDefinitions = () => {
    const process = moddle.create('bpmn:Process', { id: 'P_1', flowElements: [] });
    const collaboration = moddle.create('bpmn:Collaboration', { id: 'C_1' });
    return moddle.create('bpmn:Definitions', { rootElements: [process, collaboration] });
  };

  test('a pool diagram resolves to the same root on both sides', () => {
    const definitions = poolDefinitions();
    expect(primaryRoot(definitions)).toBe(inferPlaneRoot(definitions));
  });

  test('the element the DI plane names outranks the type order', () => {
    const definitions = poolDefinitions();
    const process = definitions.rootElements.find((r: any) => r.$type === 'bpmn:Process');
    const plane = moddle.create('bpmndi:BPMNPlane', { bpmnElement: process });
    definitions.diagrams = [moddle.create('bpmndi:BPMNDiagram', { plane })];

    expect(primaryRoot(definitions)).toBe(process);
    expect(inferPlaneRoot(definitions)).toBe(process);
  });

  test('a legacy trail on a non-primary root is still read, and migrated into `_meta.prov` on append', () => {
    const definitions = poolDefinitions();
    const process = definitions.rootElements.find((r: any) => r.$type === 'bpmn:Process');
    // Simulate a file written under the old Process-first, `<prov:activity>`-on-the-root rule.
    const existing = moddle.create('prov:Activity', { action: 'created', when: '2026-01-01T00:00:00+00:00', seed: 3 });
    process.extensionElements = moddle.create('bpmn:ExtensionElements', { values: [existing] });

    expect(readTrail(definitions)).toEqual([{ action: 'created', when: '2026-01-01T00:00:00+00:00', seed: 3 }]);

    appendTrailEntry(definitions, moddle, { action: 'modified', when: '2026-01-02T00:00:00+00:00', seed: '42' });

    expect(readTrail(definitions).map((r) => [r.action, r.seed])).toEqual([['created', 3], ['modified', 42]]);
    // Moved, not copied: the legacy entries leave the root; `_meta.prov` now holds the whole trail.
    expect(process.extensionElements.values).toHaveLength(0);
    expect(readState(definitions)._meta.prov).toHaveLength(2);
  });
});
