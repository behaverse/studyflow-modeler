import { checklistItems, resolvePlaceholders, type ChecklistItem } from '@core/document';
import { getAttribute } from '@core/element';
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

function buildChecklistGroup(el: any, definitions: any): ElementGroup | null {
  const bo = el.businessObject;
  if (!bo) return null;
  const checklist = readChecklist(bo);
  if (!checklist) return null;
  const items = checklistItems(checklist);
  if (items.length === 0) return null;
  return {
    id: el.id || bo.id || '(unnamed)',
    // A view, like the canvas: `{reached}` in a name shows the last run's value.
    label: resolvePlaceholders(bo.name || bo.id || '(unnamed)', definitions, bo.id ?? ''),
    type: bo.$type || el.type || 'Element',
    items,
  };
}

/** One group per element carrying a `studyflow:checklist`, in element-registry order. */
export function collectChecklistGroups(modeler: Editor): ElementGroup[] {
  if (!modeler) return [];
  const groups: ElementGroup[] = [];
  const definitions = modeler.getDefinitions();
  modeler.canvas.all().forEach((el: any) => {
    if (el.kind === 'label') return;
    const group = buildChecklistGroup(el, definitions);
    if (group) groups.push(group);
  });
  return groups;
}
