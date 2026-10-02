import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { RunEvent } from '@core/engine';
import { MANIFEST } from '@runtime-local/prov';
import { provOf } from '@runtime-local/w3c';

/** A run's record, `events.jsonl` or the run repository holding it, as W3C PROV-O in Turtle: into `output`, or returned. */
export function prov(record: string, output?: string): string {
  const file = existsSync(record) && statSync(record).isDirectory() ? path.join(record, 'events.jsonl') : record;
  if (!existsSync(file)) {
    // A run that kept its data out of the history left its record in the run directory alone, its digest committed.
    const manifest = path.join(path.dirname(file), MANIFEST);
    const kept = existsSync(manifest) && readFileSync(manifest, 'utf8').split('\n').some((line) => line.endsWith(`  ${path.basename(file)}`));
    throw new Error(kept
      ? `${file} was kept out of its run repository's history (${MANIFEST} holds its SHA-256): give it from the run directory it was written in`
      : `${file} does not exist: give a run's events.jsonl, or the run repository that holds it`);
  }
  const events = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as RunEvent);
  const turtle = provOf(events);
  if (!output) return turtle;
  writeFileSync(output, turtle);
  return `${output}: ${events.filter((event) => event.event === 'started').length} run(s) as W3C PROV`;
}
