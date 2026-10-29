import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { info } from '@cli/info';
import { readRecord } from '@cli/record';
import { TRACES, crateOf, type CrateFile } from '@runtime-local/rocrate';

/** What a study file is named, as `studyflow run` takes one. */
const STUDY = /\.(studyflow(\.yaml|\.png|\.svg)?|bpmn|xml)$/i;

/** The study as run in a run directory: the one study file there that no step made or was given. */
function studyIn(dir: string, data: string[]): string {
  const studies = readdirSync(dir).filter((name) => STUDY.test(name) && !data.includes(name) && statSync(path.join(dir, name)).isFile());
  if (studies.length === 1) return studies[0];
  throw new Error(`${dir} holds ${studies.length === 0 ? 'no study' : `several studies (${studies.join(', ')})`}: give the study as run, the file in it`);
}

/** A run, its run repository or the study as run in it, as a Workflow Run RO-Crate in the folder `output`: the study,
 * the record, the log, and each file the record says a step made or was given, beside `ro-crate-metadata.json`. */
export async function crate(run: string, output: string, { license }: { license: string }): Promise<string> {
  if (!existsSync(run)) throw new Error(`${run} does not exist: give a run repository, or the study as run in it`);
  const dir = statSync(run).isDirectory() ? run : path.dirname(run);
  const events = readRecord(dir);
  const data = [...new Set(events.flatMap((event) => (event.event === 'created' || event.event === 'imported' ? [event.uri] : [])))];
  const study = dir === run ? studyIn(dir, data) : path.basename(run);
  const about = (await info(path.join(dir, study))).study;
  if (existsSync(output) && readdirSync(output).length > 0) throw new Error(`${output} holds files already: give a new folder for the crate, or an empty one`);
  mkdirSync(output, { recursive: true });

  const files = new Map<string, CrateFile>();
  const missing: string[] = [];
  for (const name of [study, ...Object.keys(TRACES), ...data]) {
    const from = path.join(dir, name);
    // A file the run directory lacks, or one outside it, is not the run's to package.
    if (path.relative(dir, from).startsWith('..') || !existsSync(from)) {
      if (data.includes(name)) missing.push(name);
      continue;
    }
    const to = path.join(output, name);
    mkdirSync(path.dirname(to), { recursive: true });
    if (statSync(from).isDirectory()) {
      cpSync(from, to, { recursive: true });
      files.set(name, 'folder');
    } else {
      const bytes = readFileSync(from);
      writeFileSync(to, bytes);
      files.set(name, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  const metadata = crateOf(events, {
    study: { path: study, name: about.name ?? about.id ?? study, description: about.documentation, version: about.version },
    files, license, published: new Date().toISOString().slice(0, 10),
  });
  writeFileSync(path.join(output, 'ro-crate-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  const runs = events.filter((event) => event.event === 'started').length;
  return `${output}: ${runs} run(s) as a Workflow Run RO-Crate of ${files.size} files${missing.length > 0 ? `; not in the run directory, so left out: ${missing.join(', ')}` : ''}`;
}
