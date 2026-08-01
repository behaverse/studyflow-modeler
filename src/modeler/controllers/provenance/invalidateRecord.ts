/**
 * Invalidate one per-element run record in the open document — by marking,
 * not deleting: a new `prov:activity action="invalidated"` line joins the
 * element's trail (PROV's `prov:wasInvalidatedBy`), naming the voided run.
 *
 * The runner treats an `executed` record with a matching `invalidated`
 * marker as absent (see `element_records` in
 * `src/runner/python/studyflow_run.py`), so the step re-runs — and its
 * consumers cascade — while the history of what ran when stays in the file.
 * The edit goes through `modeling`, so it is one undoable command-stack step.
 */
import { trailTimestamp } from '@/modeler/models/provenanceTrail';

export type InvalidateProvenanceRecordCommand = {
  type: 'invalidate-provenance-record';
  /** Id of the element the record hangs on. */
  elementId: string;
  /** The live `prov:Activity` moddle entry being invalidated. */
  entry: any;
  /** Who is invalidating — the caller supplies identity, keeping this
   *  handler free of view-layer concerns like settings and app version. */
  who?: string;
  with?: string;
};

export function runInvalidateProvenanceRecord(
  modeler: any,
  command: InvalidateProvenanceRecordCommand,
): boolean {
  const element = modeler.get('elementRegistry').get(command.elementId);
  const bo = element?.businessObject;
  const extensionElements = bo?.extensionElements;
  const values: any[] = extensionElements?.values ?? [];
  if (!values.includes(command.entry)) return false;

  // Already voided: a second marker would say nothing new.
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
  modeler.get('modeling').updateModdleProperties(element, extensionElements, {
    values: [...values, marker],
  });
  return true;
}
