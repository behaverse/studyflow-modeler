import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '@core/notation';
import { toModdlePackages } from '@core/notation/schemaFile';
import { ICONS } from '@modeler/icons';
import { runInvalidateProvenanceRecord } from '@modeler/provenance/commands';
import {
  applyStatuses, assignLanes, collectProvenance, displayOrder, recordDetails, shapeIconOf,
} from '@modeler/provenance/records';
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

// The shipped example now carries a real trail (runs, a branch, a consumed marker) for the
// Provenance view to show — these tests build their own histories, so start from a clean slate.
function stripTrail(definitions: any): any {
  const strip = (el: any): void => {
    if (el?.extensionElements) {
      el.extensionElements.values = el.extensionElements.values.filter(
        (value: any) => value.$type !== 'prov:Activity');
    }
    for (const child of el?.flowElements ?? []) strip(child);
  };
  strip(primaryRoot(definitions));
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
    expect(elementRecord.icon).toBe(ICONS.plusBox);
    expect(records[0].icon).toBe(ICONS.document);

    expect(recordDetails(records[2])).toEqual([
      ['run', 'run-001'],
      ['seed', '42'],
    ]);
  });

  test('icons only for gateways, events, and containers — the rest stay bare', () => {
    const icon = (type: string) => shapeIconOf(moddle.create(type, {}));
    expect(icon('bpmn:ExclusiveGateway')).toBe(ICONS.diamond);
    expect(icon('bpmn:StartEvent')).toBe(ICONS.circle);
    expect(icon('bpmn:EndEvent')).toBe(ICONS.circle);
    expect(icon('bpmn:SubProcess')).toBe(ICONS.plusBox);
    expect(icon('bpmn:AdHocSubProcess')).toBe(ICONS.plusBox);
    expect(icon('agentic:Agent')).toBe(ICONS.plusBox);
    expect(icon('bpmn:ServiceTask')).toBeUndefined();
    expect(icon('cognitive:CognitiveTask')).toBeUndefined();
    expect(icon('bpmn:DataObjectReference')).toBeUndefined();
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
    // Void-by-reference: the marker names exactly the record it voids, and is not yet consumed.
    expect(marker.what).toBe('2026-08-01T13:00:00Z');
    expect(marker.consumed).toBeFalsy();

    expect(runInvalidateProvenanceRecord(modeler as any, {
      type: 'InvalidateProvenanceRecord', elementId: record.scopeId, entry: record.entry,
    })).toBe(false);
  });

  test('a re-executed record leaves its precise marker behind as consumed history', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    const task = firstActivity(definitions);
    stampElement(task, { action: 'executed', when: '2026-08-01T13:00:00Z', run: 'repo' });
    stampElement(task, { action: 'invalidated', when: '2026-08-01T14:00:00Z', what: '2026-08-01T13:00:00Z', run: 'repo' });

    // The re-run replaces the executed entry (the runner's `replace_action`) and keeps the marker.
    const values = task.extensionElements.values;
    task.extensionElements.values = values.filter((v: any) => v.action !== 'executed');
    stampElement(task, { action: 'executed', when: '2026-08-02T09:00:00Z', run: 'repo' });

    const records = collectProvenance(definitions).filter((r) => !r.isDocument);
    const fresh = records.find((r) => r.action === 'executed')!;
    const marker = records.find((r) => r.action === 'invalidated')!;
    expect(fresh.invalidated).toBe(false);
    expect(marker.consumed).toBe(true);
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

  test('same-second element records follow the flow graph — data before its consumers', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    const byId = new Map<string, any>();
    const index = (container: any): void => {
      for (const el of container?.flowElements ?? []) {
        byId.set(el.id, el);
        index(el);
      }
    };
    for (const root of definitions.rootElements ?? []) index(root);
    // Stamped deliberately in reverse flow order, all within the runner's one-second precision.
    const when = '2026-08-01T10:00:00Z';
    for (const id of ['split_train_test', 'select_target', 'select_features', 'input_dataset']) {
      expect(byId.get(id), `example should contain ${id}`).toBeTruthy();
      stampElement(byId.get(id), { action: id === 'input_dataset' ? 'imported' : 'executed', when, run: 'repo' });
    }

    const records = collectProvenance(definitions).filter((r) => !r.isDocument);
    expect(records.map((r) => r.scopeId)).toEqual(
      ['input_dataset', 'select_features', 'select_target', 'split_train_test']);
  });

  test('a same-second output replays right after its producer, before the next step', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    const byId = new Map<string, any>();
    const index = (container: any): void => {
      for (const el of container?.flowElements ?? []) {
        byId.set(el.id, el);
        index(el);
      }
    };
    for (const root of definitions.rootElements ?? []) index(root);
    // `write_test_report` writes `test_report`, then the flow moves on to `plot_confusion` — the
    // runner's old second-precision stamps collapse all four into one instant.
    const when = '2026-08-01T10:00:00Z';
    for (const id of ['plot_confusion', 'test_report', 'write_test_report', 'confusion_matrix']) {
      expect(byId.get(id), `example should contain ${id}`).toBeTruthy();
      stampElement(byId.get(id), { action: byId.get(id).$type.includes('Data') ? 'created' : 'executed', when, run: 'repo' });
    }

    const records = collectProvenance(definitions).filter((r) => !r.isDocument);
    expect(records.map((r) => r.scopeId)).toEqual(
      ['write_test_report', 'test_report', 'plot_confusion', 'confusion_matrix']);
  });

  test('at the same instant, a marker precedes the run stamp, and the stamp its records', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    const task = firstActivity(definitions);
    // All three share one second — the runner's stamps have second precision, so ties are real.
    stampElement(task, { action: 'executed', when: '2026-08-01T10:00:00Z', run: 'repo' });
    appendTrailEntry(definitions, moddle, { action: 'executed', when: '2026-08-01T10:00:00Z', run: 'repo' });
    stampElement(task, { action: 'invalidated', when: '2026-08-01T10:00:00Z', what: '2026-07-31T09:00:00Z', run: 'repo' });

    const actions = collectProvenance(definitions).map((r) => `${r.isDocument ? 'doc' : 'el'}:${r.action}`);
    expect(actions).toEqual(['el:invalidated', 'doc:executed', 'el:executed']);
  });

  test('a forked run supersedes records instead of replacing them — both branches stay', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    const task = firstActivity(definitions);
    stampElement(task, { action: 'executed', when: '2026-08-01T10:00:00Z', run: 'repo' });
    stampElement(task, { action: 'invalidated', when: '2026-08-01T11:00:00Z', what: '2026-08-01T10:00:00Z', run: 'repo' });
    stampElement(task, { action: 'executed', when: '2026-08-01T12:00:00Z', run: 'repo' });

    const records = collectProvenance(definitions).filter((r) => !r.isDocument);
    const [old, fresh] = records.filter((r) => r.action === 'executed');
    const marker = records.find((r) => r.action === 'invalidated')!;
    expect(old.superseded).toBe(true);
    expect(old.invalidated).toBe(true);
    expect(fresh.superseded).toBe(false);
    expect(fresh.invalidated).toBe(false);
    expect(marker.consumed).toBe(true);
  });

  test('a consumed marker forks the graph at the invocation that superseded it', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    const root = primaryRoot(definitions);
    appendTrailEntry(definitions, moddle, { action: 'executed', when: '2026-08-01T10:00:00Z', run: 'repo' });
    appendTrailEntry(definitions, moddle, { action: 'executed', when: '2026-08-02T10:00:00Z', run: 'repo' });
    const task = firstActivity(definitions);
    // The re-run's fresh record, and the consumed marker naming the record it replaced.
    stampElement(task, { action: 'executed', when: '2026-08-02T10:05:00Z', run: 'repo' });
    stampElement(task, { action: 'invalidated', when: '2026-08-01T12:00:00Z', what: '2026-08-01T10:05:00Z', run: 'repo' });
    // An untouched ✕ on another element: a pending fork, not a lane.
    const other = root.flowElements.find((e: any) => /Event$/.test(e.$type));
    stampElement(other, { action: 'executed', when: '2026-08-01T10:06:00Z', run: 'repo' });
    stampElement(other, { action: 'invalidated', when: '2026-08-02T12:00:00Z', what: '2026-08-01T10:06:00Z', run: 'repo' });

    const records = collectProvenance(definitions);
    const graph = assignLanes(records);
    const stamps = records.filter((r) => r.isDocument && r.action === 'executed');
    expect(graph.get(stamps[0])).toMatchObject({ lane: 0 });
    expect(graph.get(stamps[1])).toMatchObject({ lane: 1, laneCount: 2 });
    const fresh = records.find((r) => !r.isDocument && r.scopeId === task.id && r.action === 'executed')!;
    expect(graph.get(fresh)!.lane).toBe(1);
    // The branch's line opens at the consumed marker row, not at the run stamp.
    const consumed = records.find((r) => r.scopeId === task.id && r.action === 'invalidated')!;
    expect(graph.get(consumed)!.opens).toBe(1);
    const pending = records.find((r) => r.scopeId === other.id && r.action === 'invalidated')!;
    expect(graph.get(pending)!.pendingBranch).toBe(true);
  });

  test('two invalidations of the first branch open two separate lanes', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    const root = primaryRoot(definitions);
    appendTrailEntry(definitions, moddle, { action: 'executed', when: '2026-08-01T10:00:00Z', run: 'repo' });
    appendTrailEntry(definitions, moddle, { action: 'executed', when: '2026-08-02T10:00:00Z', run: 'repo' });
    appendTrailEntry(definitions, moddle, { action: 'executed', when: '2026-08-03T10:00:00Z', run: 'repo' });
    const task = firstActivity(definitions);
    const other = root.flowElements.find((e: any) => /Event$/.test(e.$type));
    // Run B consumed task's marker; run C consumed other's marker AND re-ran task again.
    stampElement(task, { action: 'executed', when: '2026-08-01T10:05:00Z', run: 'repo' });
    stampElement(task, { action: 'invalidated', when: '2026-08-01T12:00:00Z', what: '2026-08-01T10:05:00Z', run: 'repo' });
    stampElement(task, { action: 'executed', when: '2026-08-02T10:05:00Z', run: 'repo' });
    stampElement(task, { action: 'executed', when: '2026-08-03T10:05:00Z', run: 'repo' });
    stampElement(other, { action: 'executed', when: '2026-08-01T10:06:00Z', run: 'repo' });
    stampElement(other, { action: 'invalidated', when: '2026-08-02T12:00:00Z', what: '2026-08-01T10:06:00Z', run: 'repo' });
    stampElement(other, { action: 'executed', when: '2026-08-03T10:06:00Z', run: 'repo' });

    const records = collectProvenance(definitions);
    const graph = assignLanes(records);
    const stamps = records.filter((r) => r.isDocument && r.action === 'executed');
    expect(stamps.map((s) => graph.get(s)!.lane)).toEqual([0, 1, 2]);
    const markers = records.filter((r) => r.action === 'invalidated');
    expect(markers.map((m) => graph.get(m)!.opens).sort()).toEqual([1, 2]);
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

test.describe('replay', () => {
  /** The forked-run history: executed, then its ✕ marker, then the branch's fresh record. */
  async function forkedHistory(): Promise<any[]> {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    const task = firstActivity(definitions);
    stampElement(task, { action: 'executed', when: '2026-08-01T10:00:00Z', run: 'repo' });
    stampElement(task, { action: 'invalidated', when: '2026-08-01T11:00:00Z', what: '2026-08-01T10:00:00Z', run: 'repo' });
    stampElement(task, { action: 'executed', when: '2026-08-02T12:00:00Z', run: 'repo' });
    return collectProvenance(definitions);
  }

  const prefix = (records: any[], at: number): any[] =>
    applyStatuses(records.slice(0, at).map((r) => ({ ...r })));

  test('a prefix re-derives statuses as of that moment', async () => {
    const records = await forkedHistory();

    // Before the marker the record still stands; after it, it is voided but not yet superseded —
    // the marker is unconsumed, so this is the "branches here" moment.
    expect(prefix(records, 1)[0].standing).toBe(true);
    const [old, marker] = prefix(records, 2);
    expect(old.invalidated).toBe(true);
    expect(old.superseded).toBe(false);
    expect(marker.consumed).toBeFalsy();
  });

  test('the full prefix converges on the live flags, which stay untouched on their clones', async () => {
    const records = await forkedHistory();
    const replayed = prefix(records, records.length);

    expect(replayed.map((r) => [r.invalidated ?? false, !!r.consumed]))
      .toEqual(records.map((r) => [r.invalidated ?? false, !!r.consumed]));
    // Scrubbing mutated only clones: the marker of the live trail is still consumed.
    expect(records.find((r) => r.action === 'invalidated')!.consumed).toBe(true);
  });

  test('a run stamped after an armed marker opens its lane before the re-run lands', async () => {
    const definitions = stripTrail(await definitionsOf(exampleXml('sklearn_pipeline.studyflow.png')));
    const task = firstActivity(definitions);
    appendTrailEntry(definitions, moddle, { action: 'executed', when: '2026-08-01T10:00:00Z', run: 'repo' });
    stampElement(task, { action: 'executed', when: '2026-08-01T10:05:00Z', run: 'repo' });
    stampElement(task, { action: 'invalidated', when: '2026-08-01T12:00:00Z', what: '2026-08-01T10:05:00Z', run: 'repo' });
    // The branch's own stamp — its re-run of the step is still on the way.
    appendTrailEntry(definitions, moddle, { action: 'executed', when: '2026-08-02T10:00:00Z', run: 'repo' });

    const records = displayOrder(collectProvenance(definitions));
    const graph = assignLanes(records);
    const stamps = records.filter((r) => r.isDocument && r.action === 'executed');
    expect(graph.get(stamps[1])!.lane).toBe(1);
    const marker = records.find((r) => r.action === 'invalidated')!;
    expect(graph.get(marker)!.opens).toBe(1);
    expect(graph.get(marker)!.pendingBranch).toBeUndefined();
  });

  test('the pending branch mark appears mid-replay and resolves once the re-run lands', async () => {
    const records = await forkedHistory();

    const during = displayOrder(prefix(records, 2));
    const markerDuring = during.find((r) => r.action === 'invalidated')!;
    expect(assignLanes(during).get(markerDuring)!.pendingBranch).toBe(true);

    const after = displayOrder(prefix(records, 3));
    const markerAfter = after.find((r) => r.action === 'invalidated')!;
    expect(assignLanes(after).get(markerAfter)!.pendingBranch).toBeUndefined();
  });
});

test.describe('display order', () => {
  const record = (fields: Partial<any>): any => ({
    action: 'executed', scopeId: 'Activity_1', scopeLabel: 'A step', isDocument: false, entry: {}, ...fields,
  });

  test('a precise marker is shown below the record it voids', () => {
    const first = record({ when: '2026-07-31T10:00:00Z' });
    const second = record({ when: '2026-07-31T11:00:00Z' });
    // ✕ on the first run: `what` names the record it voids, not the moment it was voided.
    const marker = record({ action: 'invalidated', when: '2026-07-31T12:00:00Z', what: '2026-07-31T10:00:00Z' });

    const shown = displayOrder([first, second, marker]);

    expect(shown).toEqual([first, marker, second]);
  });

  test('a marker naming nothing keeps its place in time', () => {
    // A `what`-less marker is a standing re-run pin, not a verdict on one record — it must not move.
    const first = record({ when: '2026-07-31T10:00:00Z' });
    const pin = record({ action: 'invalidated', when: '2026-07-31T12:00:00Z' });

    expect(displayOrder([first, pin])).toEqual([first, pin]);
  });

  test('reordering is display only, which is why the view hands over a copy', () => {
    const first = record({ when: '2026-07-31T10:00:00Z' });
    const second = record({ when: '2026-07-31T11:00:00Z' });
    const marker = record({ action: 'invalidated', when: '2026-07-31T12:00:00Z', what: '2026-07-31T10:00:00Z' });
    const collected = [first, second, marker];

    const shown = displayOrder([...collected]);

    // The array handed in is the array handed back: `Provenance.tsx` passes a copy for exactly this reason.
    expect(shown).not.toBe(collected);
    expect(collected, 'oldest-first order survives for every other consumer')
      .toEqual([first, second, marker]);
  });
});
