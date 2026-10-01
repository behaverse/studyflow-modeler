import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { RunEvent } from '@core/engine';
import { provOf } from '@runtime-local/w3c';

/** A run's record, `events.jsonl` or the run repository holding it, as W3C PROV-O in Turtle: into `output`, or returned. */
export function prov(record: string, output?: string): string {
  const file = existsSync(record) && statSync(record).isDirectory() ? path.join(record, 'events.jsonl') : record;
  if (!existsSync(file)) throw new Error(`${file} does not exist: give a run's events.jsonl, or the run repository that holds it`);
  const events = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as RunEvent);
  const turtle = provOf(events);
  if (!output) return turtle;
  writeFileSync(output, turtle);
  return `${output}: ${events.filter((event) => event.event === 'started').length} run(s) as W3C PROV`;
}
