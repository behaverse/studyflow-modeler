import { isElement, type Element, type Value } from '@core/model/index';
import { trailTimestamp } from '@modeler/provenance/trail';
import { voids } from '@modeler/provenance/records';
import type { Editor } from '@modeler/editor/port';

export type InvalidateProvenanceRecordCommand = {
  type: 'InvalidateProvenanceRecord';
  elementId: string;
  /** The record's `prov:Activity` entry, as a provenance view read it. */
  entry: Element;
  who?: string;
  with?: string;
};

const PROV_ACTIVITY = 'prov:Activity';

const FIELDS = ['action', 'when', 'who', 'with', 'what', 'run', 'seed', 'note'] as const;

/** Whether `value` is the record `entry` is: the same entry, as another revision of the study holds it. */
function sameRecord(value: Value, entry: Element): value is Element {
  return isElement(value) && value.type === PROV_ACTIVITY && FIELDS.every((field) => String(value[field] ?? '') === String(entry[field] ?? ''));
}

export function runInvalidateProvenanceRecord(
  modeler: Editor,
  command: InvalidateProvenanceRecordCommand,
): boolean {
  let marked = false;
  const result = modeler.study.revise(command.elementId, (element) => {
    const values: Value[] = Array.isArray(element.extensionElements) ? element.extensionElements : [];
    if (!values.some((value) => sameRecord(value, command.entry))) return;
    const record = { when: (command.entry.when as string) || undefined, run: (command.entry.run as string) || undefined };
    if (values.some((value) => isElement(value) && value.type === PROV_ACTIVITY && value.action === 'invalidated' && voids(value as { what?: string; run?: string }, record))) return;

    const stamp: Element = { type: PROV_ACTIVITY, action: 'invalidated', when: trailTimestamp() };
    if (record.when) stamp.what = record.when;
    if (record.run) stamp.run = record.run;
    if (command.who) stamp.who = command.who;
    if (command.with) stamp.with = command.with;
    element.extensionElements = [...values, stamp];
    marked = true;
  });
  return marked && result.ok;
}
