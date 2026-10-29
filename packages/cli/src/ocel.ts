import { writeFileSync } from 'node:fs';

import { readRecord } from '@cli/record';
import { ocelOf } from '@runtime-local/ocel';

/** A run's record, `events.jsonl` or the run repository holding it, as an OCEL 2.0 event log in JSON: into `output`, or
 * returned. */
export function ocel(record: string, output?: string): string {
  const events = readRecord(record);
  const log = ocelOf(events);
  const json = JSON.stringify(log, null, 1);
  if (!output) return json;
  writeFileSync(output, `${json}\n`);
  return `${output}: ${events.filter((event) => event.event === 'started').length} run(s) as OCEL 2.0, ${log.events.length} events on ${log.objects.length} objects`;
}
