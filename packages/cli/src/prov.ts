import { writeFileSync } from 'node:fs';

import { readRecord } from '@cli/record';
import { provOf } from '@runtime-local/w3c';

/** A run's record, `events.jsonl` or the run repository holding it, as W3C PROV-O in Turtle: into `output`, or returned. */
export function prov(record: string, output?: string): string {
  const events = readRecord(record);
  const turtle = provOf(events);
  if (!output) return turtle;
  writeFileSync(output, turtle);
  return `${output}: ${events.filter((event) => event.event === 'started').length} run(s) as W3C PROV`;
}
