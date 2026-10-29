import { expect, test } from '@playwright/test';

import type { RunEvent } from '@core/engine';
import { ocelOf } from '@runtime-local/ocel';

/** A run's record as an OCEL 2.0 log: each step, decision, message and answer an event, concerning the run, the
 * participant it happened for, and the task, actor and datasets it involved. */

const at = (second: number): string => `2026-10-01T12:00:0${second}.000+02:00`;
const stamp = { action: 'executed', who: 'ada', with: 'studyflow-cli/1.0', run: 'r1', seed: 7, plan: 'sha256:abc' };
const RUN = 'urn:studyflow:run:r1:2026-10-01T12:00:00.000+02:00';
const PLAN = 'urn:studyflow:plan:sha256:abc';
const SUBJECT = `${RUN}/participant/Subjects#1`;
const EVENTS: RunEvent[] = [
  { event: 'started', at: at(0), run: 'r1', state: {}, stamp },
  { event: 'instance', at: at(1), id: 'Subjects', instance: 1 },
  { event: 'reached', at: at(1), id: 'Gate' },
  { event: 'executed', at: at(1), participant: 'Subjects#1', id: 'Gate', flow: 'F_Yes', entry: { node: 'Gate', name: 'Eligible?', type: 'bpmn:ExclusiveGateway', startedAt: at(1), status: 'ok' } },
  { event: 'sent', at: at(2), participant: 'Subjects#1', message: { id: 'm1', flow: 'MF_Ask', content: { q: 'ready?' } } },
  { event: 'answered', at: at(3), participant: 'Subjects#1', id: 'Model', entry: { node: 'Model', name: 'Model', type: 'bpmn:Participant', startedAt: at(2), status: 'ok', message: 'm1', actor: 'ollama://gemma4', reply: 'READY', durationMs: 12 } },
  { event: 'created', at: at(4), id: 'Trials', uri: 'data/trials.jsonl' },
  { event: 'executed', at: at(4), participant: 'Subjects#1', id: 'Task', entry: { node: 'Task', name: 'Flanker task', type: 'bpmn:Task', startedAt: at(3), status: 'ok', generated: ['Trials', 'P_Score'], durationMs: 3.5 } },
  { event: 'wrote', at: at(5), scope: 'S', name: 'arm', value: 'fast' },
  { event: 'finished', at: at(6), status: 'ok' },
];

test('each step, decision, message and answer is an event, in UTC, concerning its run and the participant it happened for', () => {
  const log = ocelOf(EVENTS);
  // The counts, a pool's instance and the values written are the study's state: no events of the log.
  expect(log.events.map(({ id, type }) => [id, type])).toEqual([
    ['1', 'started'], ['4', 'Eligible?'], ['5', 'sent'], ['6', 'answered'], ['7', 'created'], ['8', 'Flanker task'], ['10', 'finished'],
  ]);
  const event = (type: string) => log.events.find((candidate) => candidate.type === type)!;
  // A step is typed by its element's name, the activity a process model names it by, and carries its record entry.
  expect(event('Eligible?')).toEqual({
    id: '4', type: 'Eligible?', time: '2026-10-01T10:00:01.000Z',
    attributes: [
      { name: 'type', value: 'bpmn:ExclusiveGateway' }, { name: 'startedAt', value: at(1) }, { name: 'status', value: 'ok' },
      { name: 'element', value: 'Gate' }, { name: 'flow', value: 'F_Yes' },
    ],
    relationships: [{ objectId: RUN, qualifier: 'run' }, { objectId: SUBJECT, qualifier: 'participant' }],
  });
  // A task that ran concerns the task, and the datasets it wrote; a message carries its content as JSON text.
  expect(event('Flanker task').relationships.map(({ objectId, qualifier }) => [qualifier, objectId])).toEqual([
    ['run', RUN], ['participant', SUBJECT], ['task', `${PLAN}#Task`], ['dataset', `${RUN}/file/data/trials.jsonl`],
  ]);
  expect(event('sent').attributes).toEqual([{ name: 'message', value: 'm1' }, { name: 'flow', value: 'MF_Ask' }, { name: 'content', value: '{"q":"ready?"}' }]);
  // An answer is the actor's, with what answered and what it said; the participant who asked is the one it concerns.
  expect(event('answered').attributes).toEqual(expect.arrayContaining([{ name: 'actor', value: 'ollama://gemma4' }, { name: 'reply', value: 'READY' }, { name: 'element', value: 'Model' }]));
  expect(event('answered').relationships.map(({ qualifier }) => qualifier)).toEqual(['run', 'participant', 'actor']);
  expect(event('created').relationships.map(({ qualifier }) => qualifier)).toEqual(['run', 'dataset']);
});

test('the run, its participants, tasks, actors and datasets are the objects, named as the PROV-O export names them', () => {
  const log = ocelOf(EVENTS);
  expect(log.objects.map(({ id, type }) => [type, id])).toEqual([
    ['run', RUN], ['participant', SUBJECT], ['actor', `${PLAN}#Model`], ['dataset', `${RUN}/file/data/trials.jsonl`], ['task', `${PLAN}#Task`],
  ]);
  const object = (type: string) => log.objects.find((candidate) => candidate.type === type)!;
  // What never changes holds from the start; the run's status from its end.
  expect(object('run').attributes.map(({ name, value, time }) => [name, value, time])).toEqual([
    ['run', 'r1', '1970-01-01T00:00:00Z'], ['plan', 'sha256:abc', '1970-01-01T00:00:00Z'], ['seed', 7, '1970-01-01T00:00:00Z'],
    ['who', 'ada', '1970-01-01T00:00:00Z'], ['with', 'studyflow-cli/1.0', '1970-01-01T00:00:00Z'], ['status', 'ok', '2026-10-01T10:00:06.000Z'],
  ]);
  expect(object('participant').attributes.map(({ name, value }) => [name, value])).toEqual([['pool', 'Subjects'], ['instance', 1]]);
  expect(object('task').attributes.map(({ name, value }) => [name, value])).toEqual([['element', 'Task'], ['name', 'Flanker task'], ['type', 'bpmn:Task']]);
  expect(object('actor').attributes.map(({ name, value }) => [name, value])).toEqual([['element', 'Model'], ['name', 'Model'], ['implementation', 'ollama://gemma4']]);
});

test('each type is declared with its attributes, typed by their values; values of different kinds are strings', () => {
  const log = ocelOf(EVENTS);
  expect(log.objectTypes.find(({ name }) => name === 'participant')).toEqual({ name: 'participant', attributes: [{ name: 'pool', type: 'string' }, { name: 'instance', type: 'integer' }] });
  expect(log.eventTypes.find(({ name }) => name === 'Flanker task')!.attributes).toContainEqual({ name: 'durationMs', type: 'float' });
  expect(log.eventTypes.find(({ name }) => name === 'started')).toEqual({ name: 'started', attributes: [] });

  // One step's entries, once with a whole number and once with a fraction, then with a number and a text.
  const step = (second: number, fields: Record<string, unknown>): RunEvent => ({ event: 'executed', at: at(second), id: 'Task', entry: { node: 'Task', name: 'Task', type: 'bpmn:Task', startedAt: at(second), status: 'ok', ...fields } });
  const mixed = ocelOf([{ event: 'started', at: at(0), run: 'r1', state: {}, stamp }, step(1, { durationMs: 2, result: 1 }), step(2, { durationMs: 2.5, result: 'one' })]);
  expect(mixed.eventTypes.find(({ name }) => name === 'Task')!.attributes).toEqual(expect.arrayContaining([{ name: 'durationMs', type: 'float' }, { name: 'result', type: 'string' }]));
  expect(mixed.events.slice(1).map((event) => event.attributes.find(({ name }) => name === 'result')!.value)).toEqual(['1', 'one']);
});
