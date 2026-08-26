import { trailTimestamp } from '@modeler/provenance/trail';
import { voids } from '@modeler/provenance/records';
import { getEditorPort } from '@modeler/editor/registry';
import type { PortHandle } from '@modeler/editor/registry';

export type InvalidateProvenanceRecordCommand = {
  type: 'InvalidateProvenanceRecord';
  elementId: string;
  entry: any;
  who?: string;
  with?: string;
};

export function runInvalidateProvenanceRecord(
  modeler: PortHandle,
  command: InvalidateProvenanceRecordCommand,
): boolean {
  const editor = getEditorPort(modeler);
  const element = editor.elements.get(command.elementId);
  const bo = element?.businessObject;
  const extensionElements = bo?.extensionElements;
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

  const marker = editor.model.create('prov:Activity', stamp);
  marker.$parent = extensionElements;
  editor.mutate.updateModdleProperties(element, extensionElements, {
    values: [...values, marker],
  });
  return true;
}
