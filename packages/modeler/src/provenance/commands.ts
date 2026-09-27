import { trailTimestamp } from '@modeler/provenance/trail';
import { voids } from '@modeler/provenance/records';
import type { Editor } from '@modeler/editor/port';

export type InvalidateProvenanceRecordCommand = {
  type: 'InvalidateProvenanceRecord';
  elementId: string;
  entry: any;
  who?: string;
  with?: string;
};

export function runInvalidateProvenanceRecord(
  modeler: Editor,
  command: InvalidateProvenanceRecordCommand,
): boolean {
  const bo: any = modeler.study.businessObject(command.elementId);
  if (!bo) return false;
  const extensionElements = bo.extensionElements;
  const values: any[] = extensionElements?.values ?? [];
  if (!values.includes(command.entry)) return false;

  const record = { when: command.entry.when || undefined, run: command.entry.run || undefined };
  const marked = values.some((value) =>
    value?.$type === 'prov:Activity' && value.action === 'invalidated' && voids(value, record));
  if (marked) return false;

  const stamp: Record<string, string> = { action: 'invalidated', when: trailTimestamp() };
  if (record.when) stamp.what = record.when;
  if (record.run) stamp.run = record.run;
  if (command.who) stamp.who = command.who;
  if (command.with) stamp.with = command.with;

  modeler.study.edit(command.elementId, (writer) => {
    const marker = writer.create('prov:Activity', stamp);
    marker.$parent = extensionElements;
    writer.set(extensionElements, { values: [...values, marker] });
  });
  return true;
}
