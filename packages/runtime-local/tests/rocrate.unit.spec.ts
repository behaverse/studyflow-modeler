import { expect, test } from '@playwright/test';

import type { RunEvent } from '@core/engine';
import { crateOf, type CrateFile } from '@runtime-local/rocrate';

/** A run as a Workflow Run RO-Crate: the study the workflow, each run a CreateAction, the files it staged and made its
 * object and result, as the profile (https://w3id.org/ro/wfrun/workflow/0.6) and RO-Crate 1.3 ask. */

const stamp = (run: string, plan: string) => ({ action: 'executed', who: 'Ada Lovelace <ada@example.org>', with: 'studyflow-cli/1.0', run, seed: 7, plan });
const RUN1 = 'urn:studyflow:run:r1:2026-10-01T10:00:00.000Z';
const RUN2 = 'urn:studyflow:run:r1:2026-10-02T10:00:00.000Z';
/** A run, and its re-run, which made one file again and failed. */
const EVENTS: RunEvent[] = [
  { event: 'started', at: '2026-10-01T10:00:00.000Z', run: 'r1', state: {}, stamp: stamp('r1', 'sha256:abc') },
  { event: 'imported', at: '2026-10-01T10:00:01.000Z', id: 'List', uri: 'trials.csv' },
  { event: 'created', at: '2026-10-01T10:00:02.000Z', id: 'Out', uri: 'data/out.csv' },
  { event: 'created', at: '2026-10-01T10:00:03.000Z', id: 'Figures', uri: 'results' },
  { event: 'created', at: '2026-10-01T10:00:03.000Z', id: 'Gone', uri: 'gone.csv' },
  { event: 'finished', at: '2026-10-01T10:00:04.000Z', status: 'ok' },
  { event: 'started', at: '2026-10-02T10:00:00.000Z', run: 'r1', state: {}, stamp: stamp('r1', 'sha256:def') },
  { event: 'imported', at: '2026-10-02T10:00:01.000Z', id: 'List', uri: 'trials.csv' },
  { event: 'created', at: '2026-10-02T10:00:02.000Z', id: 'Out', uri: 'data/out.csv' },
  { event: 'failed', at: '2026-10-02T10:00:03.000Z', id: 'Plot', entry: { node: 'Plot', name: 'Plot', type: 'bpmn:ServiceTask', startedAt: '2026-10-02T10:00:02.000Z', status: 'error', error: { type: 'Error', message: 'no data' } } },
  { event: 'finished', at: '2026-10-02T10:00:04.000Z', status: 'error' },
];
const file = (bytes: number): CrateFile => ({ bytes, sha256: 'a'.repeat(64) });
// What the crate folder holds: `gone.csv` is not among them.
const FILES = new Map<string, CrateFile>([
  ['study.studyflow.yaml', file(100)], ['events.jsonl', file(200)], ['studyflow.log', file(300)],
  ['trials.csv', file(40)], ['data/out.csv', file(50)], ['results', 'folder'],
]);
const PARTS = { study: { path: 'study.studyflow.yaml', name: 'Flanker study', description: 'Two arms.', version: '1.2' }, files: FILES, license: 'CC-BY-4.0', published: '2026-10-29' };
type Entity = Record<string, any>;
const graphOf = (crate: Record<string, unknown>): Entity[] => crate['@graph'] as Entity[];
const entity = (crate: Record<string, unknown>, id: string): Entity => graphOf(crate).find((candidate) => candidate['@id'] === id)!;
const ids = (refs: { '@id': string }[]): string[] => refs.map((ref) => ref['@id']);

test('the crate describes itself and its root as RO-Crate 1.3 and the Workflow Run Crate profiles ask', () => {
  const crate = crateOf(EVENTS, PARTS);
  expect(crate['@context']).toEqual(['https://w3id.org/ro/crate/1.3/context', 'https://w3id.org/ro/terms/workflow-run/context']);
  expect(graphOf(crate)[0]).toEqual({ '@id': 'ro-crate-metadata.json', '@type': 'CreativeWork', conformsTo: { '@id': 'https://w3id.org/ro/crate/1.3' }, about: { '@id': './' } });
  const root = entity(crate, './');
  expect(ids(root.conformsTo)).toEqual(['https://w3id.org/ro/wfrun/process/0.6', 'https://w3id.org/ro/wfrun/workflow/0.6', 'https://w3id.org/workflowhub/workflow-ro-crate/1.1']);
  for (const [id, name, version] of [['https://w3id.org/ro/wfrun/workflow/0.6', 'Workflow Run Crate', '0.6'], ['https://w3id.org/workflowhub/workflow-ro-crate/1.1', 'Workflow RO-Crate', '1.1']]) {
    expect(entity(crate, id)).toEqual({ '@id': id, '@type': 'CreativeWork', name, version });
  }
  // What RO-Crate asks of every root, the license an entity of its own.
  expect(root).toMatchObject({ '@type': 'Dataset', name: 'Run r1 of Flanker study', description: 'Two arms.', datePublished: '2026-10-29', license: { '@id': 'https://spdx.org/licenses/CC-BY-4.0' }, mainEntity: { '@id': 'study.studyflow.yaml' } });
  expect(entity(crate, 'https://spdx.org/licenses/CC-BY-4.0')).toEqual({ '@id': 'https://spdx.org/licenses/CC-BY-4.0', '@type': 'CreativeWork', name: 'CC-BY-4.0' });
  expect(entity(crateOf(EVENTS, { ...PARTS, license: 'https://example.org/terms' }), './').license).toEqual({ '@id': 'https://example.org/terms' });
  // Every data entity is part of the root, and each run is mentioned; a file the folder lacks is left out.
  expect(ids(root.hasPart)).toEqual(['study.studyflow.yaml', 'trials.csv', 'data/out.csv', 'results/', 'events.jsonl', 'studyflow.log']);
  expect(ids(root.mentions)).toEqual([RUN1, RUN2]);
});

test('the study is the workflow, its data elements its parameters, and its files examples of them', () => {
  const crate = crateOf(EVENTS, PARTS);
  expect(entity(crate, 'study.studyflow.yaml')).toEqual({
    '@id': 'study.studyflow.yaml', '@type': ['File', 'SoftwareSourceCode', 'ComputationalWorkflow'], name: 'Flanker study', description: 'Two arms.',
    version: '1.2', identifier: 'sha256:def', programmingLanguage: { '@id': '#studyflow' }, encodingFormat: 'application/yaml', contentSize: '100',
    sha256: 'a'.repeat(64), input: [{ '@id': '#List' }], output: [{ '@id': '#Figures' }, { '@id': '#Gone' }, { '@id': '#Out' }],
  });
  expect(entity(crate, '#studyflow')).toMatchObject({ '@type': 'ComputerLanguage', name: 'Studyflow' });
  expect(entity(crate, '#Out')).toEqual({ '@id': '#Out', '@type': 'FormalParameter', name: 'Out', additionalType: 'File', conformsTo: { '@id': 'https://bioschemas.org/profiles/FormalParameter/1.0-RELEASE' } });
  expect(entity(crate, '#Figures').additionalType).toBe('Dataset');
  expect(entity(crate, 'data/out.csv')).toEqual({ '@id': 'data/out.csv', '@type': 'File', name: 'data/out.csv', encodingFormat: 'text/csv', contentSize: '50', sha256: 'a'.repeat(64), exampleOfWork: { '@id': '#Out' } });
  expect(entity(crate, 'results/')).toEqual({ '@id': 'results/', '@type': 'Dataset', name: 'results', exampleOfWork: { '@id': '#Figures' } });
  // The record and the log are the engine's traces, about every run; JSON Lines, with no media type, is a page.
  expect(entity(crate, 'events.jsonl')).toMatchObject({ encodingFormat: { '@id': 'https://jsonlines.org/' }, about: [{ '@id': RUN1 }, { '@id': RUN2 }] });
  expect(entity(crate, 'https://jsonlines.org/')).toEqual({ '@id': 'https://jsonlines.org/', '@type': 'WebSite', name: 'JSON Lines' });
});

test('each run is a CreateAction of the workflow: who ran it, what it staged and made, and how it ended', () => {
  const crate = crateOf(EVENTS, PARTS);
  expect(entity(crate, RUN1)).toEqual({
    '@id': RUN1, '@type': 'CreateAction', name: 'Run r1 of Flanker study', description: 'walked by studyflow-cli/1.0, seed 7, protocol sha256:abc',
    instrument: { '@id': 'study.studyflow.yaml' }, startTime: '2026-10-01T10:00:00.000Z', endTime: '2026-10-01T10:00:04.000Z',
    agent: { '@id': '#Ada%20Lovelace' }, object: [{ '@id': 'trials.csv' }],
    // The file the re-run made again is the re-run's: the crate holds it as the re-run left it.
    result: [{ '@id': 'results/' }], actionStatus: { '@id': 'http://schema.org/CompletedActionStatus' },
  });
  expect(entity(crate, RUN2)).toMatchObject({
    object: [{ '@id': 'trials.csv' }], result: [{ '@id': 'data/out.csv' }],
    actionStatus: { '@id': 'http://schema.org/FailedActionStatus' }, error: 'Plot: no data',
  });
  expect(entity(crate, '#Ada%20Lovelace')).toEqual({ '@id': '#Ada%20Lovelace', '@type': 'Person', name: 'Ada Lovelace', email: 'ada@example.org' });
  // A run whose record ends before it finished did not complete.
  expect(entity(crateOf(EVENTS.slice(0, 5), PARTS), RUN1)).toMatchObject({ actionStatus: { '@id': 'http://schema.org/FailedActionStatus' }, error: 'the record ends before the run finished' });
});
