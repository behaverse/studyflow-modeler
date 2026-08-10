import { checklistItems, type ChecklistItem } from '@/core/document';
import { getAttribute } from '@/core/element';
import type { Modeler } from '@/modeler/bpmn/types';

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

function buildChecklistGroup(el: any): ElementGroup | null {
  const bo = el.businessObject;
  if (!bo) return null;
  const checklist = readChecklist(bo);
  if (!checklist) return null;
  const items = checklistItems(checklist);
  if (items.length === 0) return null;
  return {
    id: el.id || bo.id || '(unnamed)',
    label: bo.name || bo.id || '(unnamed)',
    type: bo.$type || el.type || 'Element',
    items,
  };
}

/** One group per element carrying a `studyflow:checklist`, in element-registry order. */
export function collectChecklistGroups(modeler: Modeler): ElementGroup[] {
  if (!modeler) return [];
  const groups: ElementGroup[] = [];
  modeler.get('elementRegistry').forEach((el: any) => {
    if (el.type === 'label') return;
    const group = buildChecklistGroup(el);
    if (group) groups.push(group);
  });
  return groups;
}
