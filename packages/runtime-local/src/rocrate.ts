/**
 * A run as a Workflow Run RO-Crate (https://w3id.org/ro/wfrun/workflow/0.6, on RO-Crate 1.3): `ro-crate-metadata.json`,
 * the metadata of a folder that holds the study as run, its record and log, and the files its steps made and were
 * given. In the profile's terms:
 *
 * - the study is the workflow, the crate's main entity: a `ComputationalWorkflow` in the Studyflow language, identified
 *   by the protocol digest its last run recorded. Each data element whose file a run made is one of its outputs, and
 *   each whose file was staged in for a run one of its inputs: a `FormalParameter`, named by the element's id;
 * - each run in the record is a `CreateAction`, named as the PROV-O export names it (w3c.ts): its instrument is the
 *   study, its agent who ran it, its object the files staged in for it and its result the files it made, each an example
 *   of its data element's parameter. A file several runs made is the result of the last, as the crate holds it as that
 *   run left it;
 * - the record, `events.jsonl`, and the log are the engine's traces, about the runs.
 *
 * The profile has no place for the engine that ran a workflow, so a run's description says which tool walked it, and
 * from which seed and protocol.
 */
import path from 'node:path';

import type { RunEvent } from '@core/engine';
import { runIri } from '@runtime-local/w3c';

/** A file the crate holds: its size in bytes and its SHA-256, or a folder. */
export type CrateFile = { bytes: number; sha256: string } | 'folder';

export type CrateParts = {
  /** The study as run, the workflow: its path in the crate, and what it says of itself. */
  study: { path: string; name: string; description?: string; version?: string };
  /** What the crate holds, by its path in it. A file the record names that is not here is left out. */
  files: ReadonlyMap<string, CrateFile>;
  /** What the crate is shared under: an SPDX license id (`CC-BY-4.0`), or a license's URL. */
  license: string;
  /** When the crate was made, an ISO 8601 date. */
  published: string;
};

/** The traces every run leaves in its run directory, with what each is. */
export const TRACES = { 'events.jsonl': 'The record of the runs: what happened, one event a line.', 'studyflow.log': 'The log of the runs.' };

const PROFILES: [id: string, name: string, version: string][] = [
  ['https://w3id.org/ro/wfrun/process/0.6', 'Process Run Crate', '0.6'],
  ['https://w3id.org/ro/wfrun/workflow/0.6', 'Workflow Run Crate', '0.6'],
  ['https://w3id.org/workflowhub/workflow-ro-crate/1.1', 'Workflow RO-Crate', '1.1'],
];

/** The language the workflow is written in. */
const STUDYFLOW = { '@id': '#studyflow', '@type': 'ComputerLanguage', name: 'Studyflow', url: { '@id': 'https://behaverse.org/studyflow-modeler/docs/' } };

/** A file's IANA media type, by its extension. */
const MEDIA_TYPES: Record<string, string> = {
  '.studyflow': 'application/yaml', '.yaml': 'application/yaml', '.yml': 'application/yaml', '.json': 'application/json',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.txt': 'text/plain', '.log': 'text/plain', '.md': 'text/markdown',
  '.html': 'text/html', '.xml': 'application/xml', '.bpmn': 'application/xml', '.ttl': 'text/turtle',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
};
/** JSON Lines has no media type: its format is the page that specifies it. */
const JSON_LINES = { '@id': 'https://jsonlines.org/', '@type': 'WebSite', name: 'JSON Lines' };

const ref = (id: string): { '@id': string } => ({ '@id': id });

/** What a file is: its format, its size and its SHA-256. A folder says none of these. */
function described(uri: string, file: CrateFile): Record<string, unknown> {
  if (file === 'folder') return {};
  const extension = path.posix.extname(uri).toLowerCase();
  return { encodingFormat: extension === '.jsonl' ? ref(JSON_LINES['@id']) : MEDIA_TYPES[extension], contentSize: String(file.bytes), sha256: file.sha256 };
}

/** Who ran a study, as its record names them (`Name <email>`, a name, or an ORCID), as a person. */
function personOf(who: string): Record<string, unknown> {
  const orcid = /\d{4}-\d{4}-\d{4}-\d{3}[\dX]/.exec(who)?.[0];
  const signed = /^(.*?)\s*<([^<>]*)>\s*$/.exec(who);
  const name = (signed ? signed[1] : who).trim();
  return { '@id': orcid ? `https://orcid.org/${orcid}` : `#${encodeURIComponent(name)}`, '@type': 'Person', name, email: signed?.[2] || undefined };
}

type Run = { started: Extract<RunEvent, { event: 'started' }>; staged: Set<string>; failure?: string; finished?: Extract<RunEvent, { event: 'finished' }> };

/** The RO-Crate metadata of the folder `parts` describe, for every run in `events` (a repository's record holds each
 * run it redid). */
export function crateOf(events: readonly RunEvent[], parts: CrateParts): Record<string, unknown> {
  const { study, files } = parts;
  const runs: Run[] = [];
  /** The run that last made each file, and the data element that names each file made or staged. */
  const madeBy = new Map<string, Run>();
  const elementOf = new Map<string, string>();
  for (const happened of events) {
    const run = runs.at(-1);
    if (happened.event === 'started') runs.push({ started: happened, staged: new Set() });
    if (!run) continue;
    if (happened.event === 'created') madeBy.set(happened.uri, run);
    if (happened.event === 'imported') run.staged.add(happened.uri);
    if (happened.event === 'created' || happened.event === 'imported') elementOf.set(happened.uri, happened.id);
    if (happened.event === 'failed') run.failure ??= `${happened.id}: ${(happened.entry.error as { message?: string } | undefined)?.message ?? 'failed'}`;
    if (happened.event === 'finished') run.finished = happened;
  }

  // The data elements as the workflow's parameters, outputs when a run made their file and inputs when one staged it,
  // and the files the crate holds, each an example of its element's parameter.
  const parameters = (made: boolean): string[] => [...new Set([...elementOf].filter(([uri]) => madeBy.has(uri) === made).map(([, element]) => element))].sort();
  const held = new Map([...elementOf].filter(([uri]) => files.has(uri)).map(([uri, element]) => {
    const file = files.get(uri)!;
    const id = file === 'folder' ? `${uri.replace(/\/$/, '')}/` : uri;
    return [uri, { '@id': id, '@type': file === 'folder' ? 'Dataset' : 'File', name: uri, ...described(uri, file), exampleOfWork: ref(`#${element}`) }];
  }));
  const parameter = (element: string): Record<string, unknown> => ({
    '@id': `#${element}`, '@type': 'FormalParameter', name: element,
    additionalType: [...held.values()].some((data) => data.exampleOfWork['@id'] === `#${element}` && data['@type'] === 'Dataset') ? 'Dataset' : 'File',
    conformsTo: ref('https://bioschemas.org/profiles/FormalParameter/1.0-RELEASE'),
  });
  const heldAs = (uri: string): { '@id': string }[] => (held.has(uri) ? [ref(held.get(uri)!['@id'])] : []);

  const people = new Map<string, Record<string, unknown>>();
  const actions = runs.map((run) => {
    const { started, finished } = run;
    const { who, with: tool, seed, plan, clock } = started.stamp as Record<string, string | number | undefined>;
    const person = typeof who === 'string' ? personOf(who) : undefined;
    if (person) people.set(person['@id'] as string, person);
    const ok = finished?.status === 'ok';
    const description = [tool && `walked by ${tool}`, seed !== undefined && `seed ${seed}`, plan && `protocol ${plan}`, clock === 'virtual' && 'on a virtual clock'].filter(Boolean).join(', ');
    return {
      '@id': runIri(started), '@type': 'CreateAction', name: `Run ${started.run} of ${study.name}`, description: description || undefined,
      instrument: ref(study.path), startTime: started.at, endTime: finished?.at, agent: person && ref(person['@id'] as string),
      object: [...run.staged].flatMap(heldAs), result: [...madeBy].filter(([, by]) => by === run).flatMap(([uri]) => heldAs(uri)),
      actionStatus: ref(`http://schema.org/${ok ? 'Completed' : 'Failed'}ActionStatus`),
      error: ok ? undefined : run.failure ?? (finished ? 'the run ended in error' : 'the record ends before the run finished'),
    };
  });

  const workflow = {
    '@id': study.path, '@type': ['File', 'SoftwareSourceCode', 'ComputationalWorkflow'], name: study.name,
    description: study.description, version: study.version, identifier: runs.at(-1)?.started.stamp.plan,
    programmingLanguage: ref(STUDYFLOW['@id']), ...(files.has(study.path) ? described(study.path, files.get(study.path)!) : {}),
    input: parameters(false).map((element) => ref(`#${element}`)), output: parameters(true).map((element) => ref(`#${element}`)),
  };
  const traces = Object.entries(TRACES).filter(([name]) => files.has(name)).map(([name, description]) => ({
    '@id': name, '@type': 'File', name, description, ...described(name, files.get(name)!), about: actions.map((action) => ref(action['@id'])),
  }));
  const entities = [workflow, ...held.values(), ...traces];
  const license = /^https?:\/\//.test(parts.license) ? parts.license : `https://spdx.org/licenses/${parts.license}`;
  const last = runs.at(-1)?.started.run;
  const root = {
    '@id': './', '@type': 'Dataset', conformsTo: PROFILES.map(([id]) => ref(id)),
    name: last ? `Run ${last} of ${study.name}` : study.name,
    description: study.description ?? `${study.name} as run, with its record, its log, and the files its steps made and were given.`,
    datePublished: parts.published, license: ref(license), mainEntity: ref(study.path),
    hasPart: entities.map((data) => ref(data['@id'])), mentions: actions.map((action) => ref(action['@id'])),
  };
  const jsonLines = entities.some((data) => path.posix.extname(data['@id']).toLowerCase() === '.jsonl');
  return {
    '@context': ['https://w3id.org/ro/crate/1.3/context', 'https://w3id.org/ro/terms/workflow-run/context'],
    '@graph': [
      { '@id': 'ro-crate-metadata.json', '@type': 'CreativeWork', conformsTo: ref('https://w3id.org/ro/crate/1.3'), about: ref('./') },
      root,
      ...PROFILES.map(([id, name, version]) => ({ '@id': id, '@type': 'CreativeWork', name, version })),
      { '@id': license, '@type': 'CreativeWork', name: parts.license },
      workflow, STUDYFLOW,
      ...[...parameters(false), ...parameters(true)].map(parameter),
      ...actions, ...people.values(), ...held.values(), ...traces,
      ...(jsonLines ? [JSON_LINES] : []),
    ],
  };
}
