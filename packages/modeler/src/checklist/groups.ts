import { checklistItems, resolvePlaceholders, type ChecklistItem } from '@core/document';
import { getAttribute } from '@core/element';
import type { ElementRecord } from '@canvas/index.ts';
import type { Editor } from '@modeler/editor/port';

export type ElementGroup = {
  id: string;
  label: string;
  type: string;
  items: ChecklistItem[];
};

function readChecklist(bo: any): string | undefined {
  const value = getAttribute(bo, 'checklist');
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function buildChecklistGroup(record: ElementRecord, bo: any, definitions: any): ElementGroup | null {
  const checklist = readChecklist(bo);
  if (!checklist) return null;
  const items = checklistItems(checklist);
  if (items.length === 0) return null;
  return {
    id: record.id,
    // A view, like the canvas: `{reached}` in a name shows the last run's value.
    label: resolvePlaceholders(bo.name || bo.id || '(unnamed)', definitions, bo.id ?? ''),
    type: bo.$type || record.type,
    items,
  };
}

/** One group per element carrying a `studyflow:checklist`, in the order the study lists them. */
export function collectChecklistGroups(modeler: Editor): ElementGroup[] {
  if (!modeler) return [];
  const { study } = modeler;
  return study.list()
    .map((record) => buildChecklistGroup(record, study.businessObject(record.id), study.definitions))
    .filter((group): group is ElementGroup => group !== null);
}
