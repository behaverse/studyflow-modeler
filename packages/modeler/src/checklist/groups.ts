import { checklistItems, type ChecklistItem } from '@core/document';
import type { Element, StudyModel } from '@core/model/index';
import { resolvePlaceholdersIn } from '@core/model/state';
import type { ElementRecord } from '@canvas/index.ts';
import type { Editor } from '@modeler/editor/port';

export type ElementGroup = {
  id: string;
  label: string;
  type: string;
  items: ChecklistItem[];
};

function buildChecklistGroup(record: ElementRecord, model: StudyModel, element: Element | undefined): ElementGroup | null {
  const checklist = element && model.attribute(element, 'checklist');
  if (typeof checklist !== 'string' || !checklist.trim()) return null;
  const items = checklistItems(checklist);
  if (items.length === 0) return null;
  return {
    id: record.id,
    // A view, like the canvas: `{reached}` in a name shows the last run's value.
    label: resolvePlaceholdersIn(model, (typeof element!.name === 'string' && element!.name) || record.id || '(unnamed)', record.id),
    type: record.type,
    items,
  };
}

/** One group per element carrying a `studyflow:checklist`, in the order the study lists them. */
export function collectChecklistGroups(modeler: Editor): ElementGroup[] {
  const { study } = modeler;
  const { model } = study;
  return study.list()
    .map((record) => buildChecklistGroup(record, model, model.get(record.id)))
    .filter((group): group is ElementGroup => group !== null);
}
