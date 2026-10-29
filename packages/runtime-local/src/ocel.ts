/**
 * A run's record as an object-centric event log: OCEL 2.0 in its JSON format (https://www.ocel-standard.org), which
 * process-mining tools read (PM4Py's `read_ocel2_json`). The record, `events.jsonl` (packages/core/src/engine/record.ts),
 * says what happened at the study's elements; an event log says which objects each event concerns, so a tool can follow
 * one participant through the study and check that path against the protocol (flatten the log on `participant`, and
 * replay it on the study as BPMN XML):
 *
 * - each step that ran, failed or was reused, event passed and gateway decided is an event whose type is the element's
 *   name (its id when it has none), the activity a process model of the study names it by; its attributes are the
 *   element's id and the step's record entry, field by field;
 * - the run's start and end, each message sent, each answer a pool gave (a model's, with what answered and what it was
 *   asked) and each file a step made or was given are events typed as the record names them: `started`, `finished`,
 *   `sent`, `answered`, `created`, `imported`;
 * - the objects are the run, each participant (one instance of a pool of several, which the record names on the events
 *   of its steps), each task that ran, each actor that answered, and each dataset a step made or was given;
 * - every event concerns its run, and as the case may be the participant it happened for, the task that ran, the actor
 *   that answered and the datasets it made, each relationship qualified by the object's type.
 *
 * Objects are named as the PROV-O export names them (w3c.ts): a run by `runIri`, a task or an actor as an element of its
 * plan, a participant and a dataset under its run. An event's id is its line in the record, and times are UTC. The
 * counts, a pool's instances and the values written are the study's state, not events, and are left out.
 */
import type { Entry, RunEvent } from '@core/engine';
import { planIri, runIri } from '@runtime-local/w3c';

type Value = string | number | boolean;
type Kind = 'string' | 'integer' | 'float' | 'boolean';
type Attribute = { name: string; value: Value };
type Declared = { name: string; attributes: { name: string; type: Kind }[] };

export type OcelEvent = { id: string; type: string; time: string; attributes: Attribute[]; relationships: { objectId: string; qualifier: string }[] };
export type OcelObject = { id: string; type: string; attributes: (Attribute & { time: string })[] };
export type Ocel = { objectTypes: Declared[]; eventTypes: Declared[]; objects: OcelObject[]; events: OcelEvent[] };

/** When an attribute that never changes took its value, as OCEL writes it. */
const ALWAYS = '1970-01-01T00:00:00Z';

/** A value as OCEL holds one: a string, number or boolean as itself, anything else as its JSON text. */
const valueOf = (value: unknown): Value => (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
  ? value : JSON.stringify(value) ?? 'null');

/** Fields as attributes, those without a value left out. */
const attributesOf = (fields: Record<string, unknown>): Attribute[] =>
  Object.entries(fields).flatMap(([name, value]) => (value === undefined || value === null ? [] : [{ name, value: valueOf(value) }]));

/** A step's record entry, but the element's id and name, which the event gives otherwise. */
const fieldsOf = (entry: Entry | undefined): Record<string, unknown> =>
  Object.fromEntries(Object.entries(entry ?? {}).filter(([name]) => name !== 'node' && name !== 'name'));

/** A participant as the record names it, `<pool>#<instance>`, as its attributes. */
function participantOf(named: string): Record<string, unknown> {
  const at = named.lastIndexOf('#');
  return { pool: named.slice(0, at), instance: Number(named.slice(at + 1)) };
}

/** The OCEL 2.0 log, in its JSON form, of every run in `record` (a repository's record holds each run it redid). */
export function ocelOf(record: readonly RunEvent[]): Ocel {
  const objects = new Map<string, OcelObject>();
  const events: OcelEvent[] = [];
  /** An object, made the first time it is named, with the attributes it then has. */
  const object = (id: string, type: string, fields: Record<string, unknown>): string => {
    if (!objects.has(id)) objects.set(id, { id, type, attributes: attributesOf(fields).map((attribute) => ({ ...attribute, time: ALWAYS })) });
    return id;
  };
  // What the record says of an element once: its name, and its type when it is a task (no event, no gateway).
  const names = new Map<string, string>();
  const tasks = new Map<string, string>();
  let run = '';
  let plan = '';
  /** The run's datasets, by the data element that names each. */
  let datasets = new Map<string, string>();
  const taskOf = (element: string): [string, string][] =>
    (tasks.has(element) ? [[object(`${plan}#${element}`, 'task', { element, name: names.get(element), type: tasks.get(element) }), 'task']] : []);

  record.forEach((happened, line) => {
    const time = new Date(happened.at).toISOString();
    /** The event, which concerns its run, the participant it happened for, and `concerned`. */
    const add = (type: string, fields: Record<string, unknown>, concerned: [objectId: string, qualifier: string][] = []): void => {
      const participant = happened.participant && object(`${run}/participant/${happened.participant}`, 'participant', participantOf(happened.participant));
      const relationships = [[run, 'run'], ...(participant ? [[participant, 'participant']] : []), ...concerned].map(([objectId, qualifier]) => ({ objectId, qualifier }));
      events.push({ id: String(line + 1), type, time, attributes: attributesOf(fields), relationships });
    };
    switch (happened.event) {
      case 'started': {
        const { who, with: tool, seed, plan: digest, clock } = happened.stamp;
        run = object(runIri(happened), 'run', { run: happened.run, plan: digest, seed, who, with: tool, clock });
        plan = planIri(happened.stamp);
        datasets = new Map();
        add('started', {});
        break;
      }
      case 'executed':
      case 'failed': {
        const { id: element, entry } = happened;
        if (entry) names.set(element, entry.name || element);
        if (entry && !/(Event|Gateway)$/.test(entry.type)) tasks.set(element, entry.type);
        const made = ((entry?.generated as string[] | undefined) ?? []).flatMap((id): [string, string][] => (datasets.has(id) ? [[datasets.get(id)!, 'dataset']] : []));
        add(names.get(element) ?? element, { ...fieldsOf(entry), element, flow: 'flow' in happened ? happened.flow : undefined }, [...taskOf(element), ...made]);
        break;
      }
      case 'reused':
        add(names.get(happened.id) ?? happened.id, { element: happened.id, status: 'reused', flow: happened.flow, from: happened.run, trusted: happened.trusted }, taskOf(happened.id));
        break;
      case 'sent': {
        const { id, flow, content, inReplyTo } = happened.message;
        add('sent', { message: id, flow, content, inReplyTo });
        break;
      }
      case 'answered': {
        const { id: pool, entry } = happened;
        add('answered', { ...fieldsOf(entry), element: pool }, [[object(`${plan}#${pool}`, 'actor', { element: pool, name: entry.name, implementation: entry.actor }), 'actor']]);
        break;
      }
      case 'created':
      case 'imported': {
        const dataset = object(`${run}/file/${happened.uri}`, 'dataset', { element: happened.id, uri: happened.uri });
        datasets.set(happened.id, dataset);
        add(happened.event, { element: happened.id, uri: happened.uri }, [[dataset, 'dataset']]);
        break;
      }
      case 'finished':
        objects.get(run)?.attributes.push({ name: 'status', time, value: happened.status });
        add('finished', { status: happened.status });
        break;
      default: // the counts, a pool's instance or a loop's pass, and the values written: the study's state
    }
  });
  const all = [...objects.values()];
  return { objectTypes: declared(all), eventTypes: declared(events), objects: all, events };
}

const kindOf = (value: Value): Kind => (typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'float') : typeof value === 'boolean' ? 'boolean' : 'string');
const NUMBERS = new Set<Kind>(['integer', 'float']);

/** Each type `items` have, with the attributes its items carry, each typed by its values: whole numbers and others
 * make a float, and values of different kinds a string, which they are then made. */
function declared(items: { type: string; attributes: Attribute[] }[]): Declared[] {
  const types = new Map<string, Map<string, Kind>>();
  for (const { type, attributes } of items) {
    const kinds = types.get(type) ?? new Map<string, Kind>();
    types.set(type, kinds);
    for (const { name, value } of attributes) {
      const [before, kind] = [kinds.get(name), kindOf(value)];
      kinds.set(name, !before || before === kind ? kind : NUMBERS.has(before) && NUMBERS.has(kind) ? 'float' : 'string');
    }
  }
  for (const { type, attributes } of items) {
    for (const attribute of attributes) if (types.get(type)!.get(attribute.name) === 'string') attribute.value = String(attribute.value);
  }
  return [...types].map(([name, kinds]) => ({ name, attributes: [...kinds].map(([attribute, type]) => ({ name: attribute, type })) }));
}
