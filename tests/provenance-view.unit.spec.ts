import { expect, test } from '@playwright/test';

import { Study } from '@canvas/index.ts';
import { studyflowToXml, xmlToStudy } from '@core/document';
import { isElement, type Element, type StudyModel } from '@core/model/index';
import { studyText } from '@core/model/yaml';
import { ICONS } from '@modeler/icons';
import { runInvalidateProvenanceRecord } from '@modeler/provenance/commands';
import {
  applyStatuses, assignLanes, collectProvenance, displayOrder, recordDetails, voids,
} from '@modeler/provenance/records';
import { appendTrailEntry } from '@modeler/provenance/trail';
import { freshMetamodel, freshModdle } from './schemas';
import { exampleXml } from './utils';

/** The document trail merged with the per-element `executed` records a run archives, oldest first. */

const metamodel = freshMetamodel();

async function modelOf(xml: string): Promise<StudyModel> {
  return xmlToStudy(xml, metamodel);
}

const activitiesOf = (el: Element): Element[] => (Array.isArray(el.extensionElements) ? el.extensionElements.filter(isElement) : []);

// The shipped example carries a real trail (runs, a branch, a consumed marker) for the
// Provenance view to show; these tests build their own histories, so start from a clean slate.
function stripTrail(model: StudyModel): StudyModel {
  for (const el of model.all()) {
    if (Array.isArray(el.extensionElements)) el.extensionElements = activitiesOf(el).filter((value) => value.type !== 'prov:Activity');
  }
  delete (model.study.state?._meta as { prov?: unknown } | undefined)?.prov;
  return model;
}

/** The runner's per-element stamp: an `executed` activity on the element itself. */
function stampElement(el: Element, stamp: Record<string, string>): void {
  el.extensionElements = [...activitiesOf(el), { type: 'prov:Activity', ...stamp }];
}

const flowElementsOf = (model: StudyModel): Element[] => {
  const root = model.primaryRoot()!;
  return Array.isArray(root.flowElements) ? root.flowElements.filter(isElement) : [];
};

function firstActivity(model: StudyModel): Element {
  const el = flowElementsOf(model).find((e) => /Task|SubProcess/.test(model.host(e)));
  expect(el, 'example should contain an activity to stamp').toBeTruthy();
  return el!;
}

const firstEvent = (model: StudyModel): Element => flowElementsOf(model).find((e) => /Event$/.test(model.host(e)))!;

/** What `runInvalidateProvenanceRecord` touches: a study of `model`, which it edits. */
async function mockModeler(model: StudyModel) {
  return { study: await Study.open(studyText(model.study, model.metamodel), { moddle: freshModdle() }) };
}

test.describe('provenance view model', () => {
  test('merges the document trail with per-element run records, oldest first', async () => {
    const model = stripTrail(await modelOf(await exampleXml('sklearn_pipeline')));

    appendTrailEntry(model, {
      action: 'created',
      when: '2026-07-30T08:00:00Z',
      with: 'studyflow-modeler/26.0731',
    });
    appendTrailEntry(model, {
      action: 'executed',
      when: '2026-07-31T10:00:00Z',
      who: '',
      run: 'run-001',
      seed: '42',
    });
    const task = firstActivity(model);
    stampElement(task, {
      action: 'executed',
      when: '2026-07-31T09:59:00Z',
      run: 'run-001',
    });

    const records = collectProvenance(model);
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
    // Document rows project plain `_meta.prov` records, not `prov:Activity` entries, and an empty fact (`who`) is left out.
    expect(records[2].entry).toEqual({ action: 'executed', when: '2026-07-31T10:00:00Z', run: 'run-001', seed: 42 });
  });

  test('sorts undated entries last and keeps document order among them', async () => {
    const model = stripTrail(await modelOf(await exampleXml('sklearn_pipeline')));

    appendTrailEntry(model, { action: 'created', when: '' });
    appendTrailEntry(model, { action: 'modified', when: '2026-07-31T11:00:00Z' });
    appendTrailEntry(model, { action: 'reviewed', when: '' });

    const records = collectProvenance(model);
    expect(records.map((r) => r.action)).toEqual(['modified', 'created', 'reviewed']);
    expect(records[1].when).toBeUndefined();
  });

  test('invalidating a run record keeps it and appends a marker, once', async () => {
    const model = stripTrail(await modelOf(await exampleXml('sklearn_pipeline')));
    const task = firstActivity(model);
    stampElement(task, { action: 'executed', when: '2026-08-01T13:00:00Z', run: 'run-003' });
    const before = activitiesOf(task).length;

    const modeler = await mockModeler(model);
    const record = collectProvenance(modeler.study.model).find((r) => !r.isDocument)!;

    expect(runInvalidateProvenanceRecord(modeler as any, {
      type: 'InvalidateProvenanceRecord', elementId: record.scopeId, entry: record.entry,
    })).toBe(true);

    expect(activitiesOf(modeler.study.element(task.id!)!).length).toBe(before + 1);
    const after = collectProvenance(modeler.study.model).filter((r) => !r.isDocument);
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

  test('a precise marker is consumed once its record is replaced or superseded', async () => {
    const CASES = [
      // The runner's `replace_action`: the re-run swaps the executed entry out and keeps the marker.
      { label: 'replaced', keepOld: false },
      // A forked run keeps the record it supersedes beside the fresh one: both branches stay.
      { label: 'superseded', keepOld: true },
    ];
    for (const { label, keepOld } of CASES) {
      const model = stripTrail(await modelOf(await exampleXml('sklearn_pipeline')));
      const task = firstActivity(model);
      stampElement(task, { action: 'executed', when: '2026-08-01T10:00:00Z', run: 'repo' });
      stampElement(task, { action: 'invalidated', when: '2026-08-01T11:00:00Z', what: '2026-08-01T10:00:00Z', run: 'repo' });
      if (!keepOld) {
        task.extensionElements = activitiesOf(task).filter((v) => v.action !== 'executed');
      }
      stampElement(task, { action: 'executed', when: '2026-08-01T12:00:00Z', run: 'repo' });

      const records = collectProvenance(model).filter((r) => !r.isDocument);
      const executed = records.filter((r) => r.action === 'executed');
      const fresh = executed.at(-1)!;
      expect(fresh.invalidated, label).toBe(false);
      expect(fresh.superseded, label).toBe(false);
      expect(records.find((r) => r.action === 'invalidated')!.consumed, label).toBe(true);
      if (keepOld) expect([executed[0].invalidated, executed[0].superseded], label).toEqual([true, true]);
    }
  });

  test('a marker voids the record its `what` names, else every record of its run, or of any run when it names none', () => {
    const record = { when: '2026-08-01T13:00:00Z', run: 'run-004' };
    const CASES: Array<[string, { what?: string; run?: string }, boolean]> = [
      ['names this record', { what: '2026-08-01T13:00:00Z', run: 'run-999' }, true],
      ['names another record', { what: '2026-08-01T12:00:00Z', run: 'run-004' }, false],
      ['names no record, this run', { run: 'run-004' }, true],
      ['names no record, a foreign run', { run: 'run-999' }, false],
      ['names no record and no run', {}, true],
    ];
    for (const [label, marker, expected] of CASES) expect(voids(marker, record), label).toBe(expected);
  });

  test('same-second ties: a marker, then the run stamp, then element records in flow order', async () => {
    // The runner's stamps have second precision, so ties are real: every stamp in a row shares one second.
    const when = '2026-08-01T10:00:00Z';
    const CASES: Array<[string, Array<[string, string, string?]>, string[]]> = [
      ['stamped in reverse flow order: data before its consumers',
        [['split_train_test', 'executed'], ['select_target', 'executed'], ['select_features', 'executed'], ['input_dataset', 'imported']],
        ['input_dataset:imported', 'select_features:executed', 'select_target:executed', 'split_train_test:executed']],
      ['`write_test_report` writes `test_report`, then the flow moves on to `plot_confusion`',
        [['plot_confusion', 'executed'], ['test_report', 'created'], ['write_test_report', 'executed'], ['confusion_matrix', 'created']],
        ['write_test_report:executed', 'test_report:created', 'plot_confusion:executed', 'confusion_matrix:created']],
      ['a marker precedes the run stamp, and the stamp its records',
        [['split_train_test', 'executed'], ['document', 'executed'], ['split_train_test', 'invalidated', '2026-07-31T09:00:00Z']],
        ['split_train_test:invalidated', 'document:executed', 'split_train_test:executed']],
    ];
    for (const [label, stamps, expected] of CASES) {
      const model = stripTrail(await modelOf(await exampleXml('sklearn_pipeline')));
      const byId = new Map([...model.elements()].map((el) => [el.id!, el]));
      for (const [target, action, what] of stamps) {
        if (target === 'document') {
          appendTrailEntry(model, { action, when, run: 'repo' });
          continue;
        }
        expect(byId.get(target), `${label}: sklearn_pipeline has ${target}`).toBeTruthy();
        stampElement(byId.get(target)!, { action, when, run: 'repo', ...(what ? { what } : {}) });
      }

      const order = collectProvenance(model).map((r) => `${r.isDocument ? 'document' : r.scopeId}:${r.action}`);
      expect(order, label).toEqual(expected);
    }
  });

  test('a consumed marker forks the graph at the invocation that superseded it', async () => {
    const model = stripTrail(await modelOf(await exampleXml('sklearn_pipeline')));
        appendTrailEntry(model, { action: 'executed', when: '2026-08-01T10:00:00Z', run: 'repo' });
    appendTrailEntry(model, { action: 'executed', when: '2026-08-02T10:00:00Z', run: 'repo' });
    const task = firstActivity(model);
    // The re-run's fresh record, and the consumed marker naming the record it replaced.
    stampElement(task, { action: 'executed', when: '2026-08-02T10:05:00Z', run: 'repo' });
    stampElement(task, { action: 'invalidated', when: '2026-08-01T12:00:00Z', what: '2026-08-01T10:05:00Z', run: 'repo' });
    // An untouched ✕ on another element: a pending fork, not a lane.
    const other = firstEvent(model);
    stampElement(other, { action: 'executed', when: '2026-08-01T10:06:00Z', run: 'repo' });
    stampElement(other, { action: 'invalidated', when: '2026-08-02T12:00:00Z', what: '2026-08-01T10:06:00Z', run: 'repo' });

    const records = collectProvenance(model);
    const graph = assignLanes(records);
    const stamps = records.filter((r) => r.isDocument && r.action === 'executed');
    expect(graph.get(stamps[0])).toMatchObject({ lane: 0 });
    expect(graph.get(stamps[1])).toMatchObject({ lane: 1, laneCount: 2 });
    const fresh = records.find((r) => !r.isDocument && r.scopeId === task.id && r.action === 'executed')!;
    expect(graph.get(fresh)!.lane).toBe(1);
    // The branch's line opens at the consumed marker row, not at the run stamp.
    const consumed = records.find((r) => r.scopeId === task.id && r.action === 'invalidated')!;
    expect(graph.get(consumed)!.opens).toBe(1);
    // Once its re-run has landed the branch is drawn, so the pending mark is gone.
    expect(graph.get(consumed)!.pendingBranch).toBeUndefined();
    const pending = records.find((r) => r.scopeId === other.id && r.action === 'invalidated')!;
    expect(graph.get(pending)!.pendingBranch).toBe(true);
  });

  test('two invalidations of the first branch open two separate lanes', async () => {
    const model = stripTrail(await modelOf(await exampleXml('sklearn_pipeline')));
        appendTrailEntry(model, { action: 'executed', when: '2026-08-01T10:00:00Z', run: 'repo' });
    appendTrailEntry(model, { action: 'executed', when: '2026-08-02T10:00:00Z', run: 'repo' });
    appendTrailEntry(model, { action: 'executed', when: '2026-08-03T10:00:00Z', run: 'repo' });
    const task = firstActivity(model);
    const other = firstEvent(model);
    // Run B consumed task's marker; run C consumed other's marker AND re-ran task again.
    stampElement(task, { action: 'executed', when: '2026-08-01T10:05:00Z', run: 'repo' });
    stampElement(task, { action: 'invalidated', when: '2026-08-01T12:00:00Z', what: '2026-08-01T10:05:00Z', run: 'repo' });
    stampElement(task, { action: 'executed', when: '2026-08-02T10:05:00Z', run: 'repo' });
    stampElement(task, { action: 'executed', when: '2026-08-03T10:05:00Z', run: 'repo' });
    stampElement(other, { action: 'executed', when: '2026-08-01T10:06:00Z', run: 'repo' });
    stampElement(other, { action: 'invalidated', when: '2026-08-02T12:00:00Z', what: '2026-08-01T10:06:00Z', run: 'repo' });
    stampElement(other, { action: 'executed', when: '2026-08-03T10:06:00Z', run: 'repo' });

    const records = collectProvenance(model);
    const graph = assignLanes(records);
    const stamps = records.filter((r) => r.isDocument && r.action === 'executed');
    expect(stamps.map((s) => graph.get(s)!.lane)).toEqual([0, 1, 2]);
    const markers = records.filter((r) => r.action === 'invalidated');
    expect(markers.map((m) => graph.get(m)!.opens).sort()).toEqual([1, 2]);
  });

  test('per-element records survive the XML round trip', async () => {
    const model = stripTrail(await modelOf(await exampleXml('sklearn_pipeline')));
    const task = firstActivity(model);
    stampElement(task, {
      action: 'executed',
      when: '2026-07-31T12:00:00Z',
      run: 'run-002',
      seed: '7',
    });

    const xml = await studyflowToXml(studyText(model.study, model.metamodel), freshModdle());
    const records = collectProvenance(await modelOf(xml));

    expect(records).toHaveLength(1);
    expect(records[0].isDocument).toBe(false);
    expect(records[0].scopeId).toBe(task.id);
    expect(records[0].run).toBe('run-002');
    // A number, not '7': `prov:Activity#seed` is declared `Integer`, matching `studyflow:Study#seed`.
    expect(records[0].seed).toBe(7);
  });
});

test.describe('replay', () => {
  /** The forked-run history: executed, then its ✕ marker, then the branch's fresh record. */
  async function forkedHistory(): Promise<any[]> {
    const model = stripTrail(await modelOf(await exampleXml('sklearn_pipeline')));
    const task = firstActivity(model);
    stampElement(task, { action: 'executed', when: '2026-08-01T10:00:00Z', run: 'repo' });
    stampElement(task, { action: 'invalidated', when: '2026-08-01T11:00:00Z', what: '2026-08-01T10:00:00Z', run: 'repo' });
    stampElement(task, { action: 'executed', when: '2026-08-02T12:00:00Z', run: 'repo' });
    return collectProvenance(model);
  }

  const prefix = (records: any[], at: number): any[] =>
    applyStatuses(records.slice(0, at).map((r) => ({ ...r })));

  test('a prefix re-derives statuses as of that moment', async () => {
    const records = await forkedHistory();

    // Before the marker the record still stands; after it, it is voided but not yet superseded.
    // The marker is unconsumed, so this is the "branches here" moment.
    expect(prefix(records, 1)[0].standing).toBe(true);
    const [old, marker] = prefix(records, 2);
    expect(old.invalidated).toBe(true);
    expect(old.superseded).toBe(false);
    expect(marker.consumed).toBeFalsy();
  });

  test('a run stamped after an armed marker opens its lane before the re-run lands', async () => {
    const model = stripTrail(await modelOf(await exampleXml('sklearn_pipeline')));
    const task = firstActivity(model);
    appendTrailEntry(model, { action: 'executed', when: '2026-08-01T10:00:00Z', run: 'repo' });
    stampElement(task, { action: 'executed', when: '2026-08-01T10:05:00Z', run: 'repo' });
    stampElement(task, { action: 'invalidated', when: '2026-08-01T12:00:00Z', what: '2026-08-01T10:05:00Z', run: 'repo' });
    // The branch's own stamp; its re-run of the step is still on the way.
    appendTrailEntry(model, { action: 'executed', when: '2026-08-02T10:00:00Z', run: 'repo' });

    const records = displayOrder(collectProvenance(model));
    const graph = assignLanes(records);
    const stamps = records.filter((r) => r.isDocument && r.action === 'executed');
    expect(graph.get(stamps[1])!.lane).toBe(1);
    const marker = records.find((r) => r.action === 'invalidated')!;
    expect(graph.get(marker)!.opens).toBe(1);
    expect(graph.get(marker)!.pendingBranch).toBeUndefined();
  });
});

test.describe('display order', () => {
  const record = (fields: Partial<any>): any => ({
    action: 'executed', scopeId: 'Activity_1', scopeLabel: 'A step', isDocument: false, entry: {}, ...fields,
  });

  test('a precise marker is shown below the record it voids; one naming nothing keeps its place in time', () => {
    const first = record({ when: '2026-07-31T10:00:00Z' });
    const second = record({ when: '2026-07-31T11:00:00Z' });
    // ✕ on the first run: `what` names the record it voids, not the moment it was voided.
    const marker = record({ action: 'invalidated', when: '2026-07-31T12:00:00Z', what: '2026-07-31T10:00:00Z' });
    // A `what`-less marker is a standing re-run pin, not a verdict on one record; it must not move.
    const pin = record({ action: 'invalidated', when: '2026-07-31T12:00:00Z' });
    const CASES: Array<[string, any[], any[]]> = [
      ['a precise marker', [first, second, marker], [first, marker, second]],
      ['a marker naming nothing', [first, second, pin], [first, second, pin]],
    ];
    for (const [label, collected, shown] of CASES) expect(displayOrder(collected), label).toEqual(shown);
  });
});
