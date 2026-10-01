import type { Issue } from '@core/checks';
import { quoted } from '@core/checks/graph';
import { isElement, type Element, type StudyModel, type Value } from '@core/model/index';

/**
 * Every id names one element. Two scopes may each hold an element of the same id in the file, and then a reference
 * to it reaches only one of them, and a run, which keeps its values and records by id, keeps one: an error, not the
 * reader's warning, since what is lost says nothing of itself.
 */
export function checkIds(model: StudyModel): Issue[] {
  const named = new Map<string, Element[]>();
  const visit = (value: Value | undefined): void => {
    if (Array.isArray(value)) value.forEach(visit);
    if (!isElement(value)) return;
    if (typeof value.id === 'string' && model.host(value).startsWith('bpmn:')) named.set(value.id, [...(named.get(value.id) ?? []), value]);
    for (const [key, child] of Object.entries(value)) if (key !== 'type') visit(child);
  };
  model.study.roots.forEach(visit);
  return [...named].filter(([, elements]) => elements.length > 1).map(([id, elements]) => ({
    severity: 'error',
    elementId: id,
    message: `the id ${JSON.stringify(id)} names ${elements.length} elements (${elements.map(quoted).join(', ')}): a reference to it reaches only one, and a run keeps one`,
  }));
}
