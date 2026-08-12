import { trailTimestamp } from '@modeler/provenance/trail';
import type { Modeler } from '@modeler/bpmn/types';

export type InvalidateProvenanceRecordCommand = {
  type: 'InvalidateProvenanceRecord';
  elementId: string;
  entry: any;
  who?: string;
  with?: string;
};

export function runInvalidateProvenanceRecord(
  modeler: Modeler,
  command: InvalidateProvenanceRecordCommand,
): boolean {
  const element = modeler.get('elementRegistry').get(command.elementId);
  const bo = element?.businessObject;
  const extensionElements = bo?.extensionElements;
  const values: any[] = extensionElements?.values ?? [];
  if (!values.includes(command.entry)) return false;

  const run = command.entry.run || undefined;
  const marked = values.some((value) =>
    value?.$type === 'prov:Activity'
    && value.action === 'invalidated'
    && (!value.run || value.run === run));
  if (marked) return false;

  const stamp: Record<string, string> = { action: 'invalidated', when: trailTimestamp() };
  if (run) stamp.run = run;
  if (command.who) stamp.who = command.who;
  if (command.with) stamp.with = command.with;

  const marker = modeler.get('moddle').create('prov:Activity', stamp);
  marker.$parent = extensionElements;
  modeler.get('modeling').updateModdleProperties(element as any, extensionElements, {
    values: [...values, marker],
  });
  return true;
}
