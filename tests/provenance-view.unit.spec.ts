import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '@core/notation';
import { toModdlePackages } from '@core/notation/schemaFile';
import { ICONS } from '@modeler/icons';
import { runInvalidateProvenanceRecord } from '@modeler/provenance/commands';
import { collectProvenance, recordDetails, shapeIconOf } from '@modeler/provenance/records';
import { appendTrailEntry, primaryRoot } from '@modeler/provenance/trail';
import { loadSchemaModels } from './schemas';
import { exampleXml } from './utils';

/** The document trail merged with the per-element `executed` records a run archives, oldest first. */

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

function stripTrail(definitions: any): any {
  const ext = primaryRoot(definitions).extensionElements;
  if (ext) ext.values = ext.values.filter((value: any) => value.$type !== 'prov:Activity');
  return definitions;
}

/** The runner's per-element stamp: an `executed` activity on the element itself. */
function stampElement(el: any, stamp: Record<string, string>): void {
  const entry = moddle.create('prov:Activity', stamp);
  if (!el.extensionElements) {
    el.extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    el.extensionElements.$parent = el;
  }
  el.extensionElements.values.push(entry);
  entry.$parent = el.extensionElements;
}

function firstActivity(definitions: any): any {
  const root = primaryRoot(definitions);
  const el = root.flowElements.find((e: any) => /Task|SubProcess/.test(e.$type));
  expect(el, 'example should contain an activity to stamp').toBeTruthy();
  return el;
}

/** The services `runInvalidateProvenanceRecord` touches, over real moddle objects. */
function mockModeler(definitions: any) {
  const registry = new Map<string, any>();
  const index = (container: any) => {
    for (const el of container?.flowElements ?? []) {
      if (el.id) registry.set(el.id, { businessObject: el });
      index(el);
    }
  };
  for (const root of definitions.rootElements ?? []) index(root);

  const services: Record<string, any> = {
    elementRegistry: { get: (id: string) => registry.get(id) },
    moddle,
    modeling: {
      updateModdleProperties(_element: any, moddleObject: any, props: Record<string, any>) {
        Object.assign(moddleObject, props);
      },
    },
  };
  return { get: (name: string) => services[name], getDefinitions: () => definitions };
}

test.describe('provenance view model', () => {
  test('merges the document trail with per-element run records, oldest first', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));

    appendTrailEntry(definitions, moddle, {
      action: 'created',
      when: '2026-07-30T08:00:00Z',
      with: 'studyflow-modeler/26.0731',
    });
    appendTrailEntry(definitions, moddle, {
      action: 'executed',
      when: '2026-07-31T10:00:00Z',
      run: 'run-001',
      seed: '42',
    });
    const task = firstActivity(definitions);
    stampElement(task, {
      action: 'executed',
      when: '2026-07-31T09:59:00Z',
      run: 'run-001',
    });

    const records = collectProvenance(definitions);
    expect(records.map((r) => [r.action, r.when, r.isDocument])).toEqual([
      ['created', '2026-07-30T08:00:00Z', true],
      ['executed', '2026-07-31T09:59:00Z', false],
      ['executed', '2026-07-31T10:00:00Z', true],
    ]);

    const elementRecord = records[1];
    expect(elementRecord.scopeId).toBe(task.id);
    expect(elementRecord.scopeLabel).toBe(task.name || task.id);
    expect(elementRecord.run).toBe('run-001');
    expect(elementRecord.icon).toBe(ICONS.square);
    expect(records[0].icon).toBe(ICONS.document);

    expect(recordDetails(records[2])).toEqual([
      ['run', 'run-001'],
      ['seed', '42'],
    ]);
  });

  test('maps element types onto the four palette shape icons', () => {
    expect(shapeIconOf('bpmn:ExclusiveGateway')).toBe(ICONS.diamond);
    expect(shapeIconOf('bpmn:StartEvent')).toBe(ICONS.circle);
    expect(shapeIconOf('bpmn:EndEvent')).toBe(ICONS.circle);
    expect(shapeIconOf('bpmn:DataObjectReference')).toBe(ICONS.database);
    expect(shapeIconOf('bpmn:ServiceTask')).toBe(ICONS.square);
    expect(shapeIconOf('bpmn:SubProcess')).toBe(ICONS.square);
    expect(shapeIconOf('studyflow:CognitiveTask')).toBe(ICONS.square);
  });

  test('sorts undated entries last and keeps document order among them', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));

    appendTrailEntry(definitions, moddle, { action: 'created', when: '' });
    appendTrailEntry(definitions, moddle, { action: 'modified', when: '2026-07-31T11:00:00Z' });
    appendTrailEntry(definitions, moddle, { action: 'reviewed', when: '' });

    const records = collectProvenance(definitions);
    expect(records.map((r) => r.action)).toEqual(['modified', 'created', 'reviewed']);
    expect(records[1].when).toBeUndefined();
  });

  test('invalidating a run record keeps it and appends a marker, once', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    const task = firstActivity(definitions);
    stampElement(task, { action: 'executed', when: '2026-08-01T13:00:00Z', run: 'run-003' });
    const before = task.extensionElements.values.length;

    const modeler = mockModeler(definitions);
    const record = collectProvenance(definitions).find((r) => !r.isDocument)!;

    expect(runInvalidateProvenanceRecord(modeler as any, {
      type: 'InvalidateProvenanceRecord', elementId: record.scopeId, entry: record.entry,
    })).toBe(true);

    expect(task.extensionElements.values.length).toBe(before + 1);
    const after = collectProvenance(definitions).filter((r) => !r.isDocument);
    const executed = after.find((r) => r.action === 'executed')!;
    const marker = after.find((r) => r.action === 'invalidated')!;
    expect(executed.invalidated).toBe(true);
    expect(marker.run).toBe('run-003');
    expect(marker.scopeId).toBe(task.id);
    expect(marker.when).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);

    expect(runInvalidateProvenanceRecord(modeler as any, {
      type: 'InvalidateProvenanceRecord', elementId: record.scopeId, entry: record.entry,
    })).toBe(false);
  });

  test('a runless marker voids any executed record; a foreign run voids none', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    const root = primaryRoot(definitions);
    const events = root.flowElements.filter((e: any) => /Event$/.test(e.$type));
    expect(events.length).toBeGreaterThanOrEqual(2);

    stampElement(events[0], { action: 'executed', when: '2026-08-01T13:00:00Z', run: 'run-004' });
    stampElement(events[0], { action: 'invalidated', when: '2026-08-01T13:05:00Z' });
    stampElement(events[1], { action: 'executed', when: '2026-08-01T13:00:00Z', run: 'run-004' });
    stampElement(events[1], { action: 'invalidated', when: '2026-08-01T13:05:00Z', run: 'run-999' });

    const records = collectProvenance(definitions);
    const voided = records.find((r) => r.scopeId === events[0].id && r.action === 'executed')!;
    const intact = records.find((r) => r.scopeId === events[1].id && r.action === 'executed')!;
    expect(voided.invalidated).toBe(true);
    expect(intact.invalidated).toBe(false);
  });

  test('per-element records survive the XML round trip', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    const task = firstActivity(definitions);
    stampElement(task, {
      action: 'executed',
      when: '2026-07-31T12:00:00Z',
      run: 'run-002',
      seed: '7',
    });

    const { xml } = await moddle.toXML(definitions, { format: true });
    const records = collectProvenance(await definitionsOf(xml));

    expect(records).toHaveLength(1);
    expect(records[0].isDocument).toBe(false);
    expect(records[0].scopeId).toBe(task.id);
    expect(records[0].run).toBe('run-002');
    // A number, not '7': `prov:Activity#seed` is declared `Integer`, matching `studyflow:Seed#seed`.
    expect(records[0].seed).toBe(7);
  });
});
