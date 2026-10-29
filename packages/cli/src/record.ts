import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { RunEvent } from '@core/engine';
import { MANIFEST } from '@runtime-local/prov';

/** A run's record, `events.jsonl` or the run repository holding it: its events, in order, which `prov`, `crate` and
 * `ocel` write in other standards. */
export function readRecord(record: string): RunEvent[] {
  const file = existsSync(record) && statSync(record).isDirectory() ? path.join(record, 'events.jsonl') : record;
  if (!existsSync(file)) {
    // A run that kept its data out of the history left its record in the run directory alone, its digest committed.
    const manifest = path.join(path.dirname(file), MANIFEST);
    const kept = existsSync(manifest) && readFileSync(manifest, 'utf8').split('\n').some((line) => line.endsWith(`  ${path.basename(file)}`));
    throw new Error(kept
      ? `${file} was kept out of its run repository's history (${MANIFEST} holds its SHA-256): give it from the run directory it was written in`
      : `${file} does not exist: give a run's events.jsonl, or the run repository that holds it`);
  }
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as RunEvent);
}
