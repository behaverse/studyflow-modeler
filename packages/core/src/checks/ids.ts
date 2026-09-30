import type { ModdleElement } from '@core/element/moddle';
import type { Issue } from '@core/checks';
import { quoted } from '@core/checks/graph';

/**
 * Every id names one element. Two scopes may each hold an element of the same id in the file, and then a reference
 * to it reaches only one of them, and a run, which keeps its values and records by id, keeps one: an error, not the
 * reader's warning, since what is lost says nothing of itself.
 */
export function checkIds(definitions: ModdleElement): Issue[] {
  const named = new Map<string, ModdleElement[]>();
  const seen = new Set<unknown>();
  const visit = (element: ModdleElement): void => {
    if (!element || typeof element !== 'object' || seen.has(element)) return;
    seen.add(element);
    if (typeof element.id === 'string' && element.$type?.startsWith('bpmn:') && element.$type !== 'bpmn:Definitions') {
      named.set(element.id, [...(named.get(element.id) ?? []), element]);
    }
    for (const property of element.$descriptor?.properties ?? []) {
      if (property.isReference) continue;
      const value = element[property.name];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object' && '$type' in value) visit(value);
    }
  };
  visit(definitions);
  return [...named].filter(([, elements]) => elements.length > 1).map(([id, elements]) => ({
    severity: 'error',
    elementId: id,
    message: `the id ${JSON.stringify(id)} names ${elements.length} elements (${elements.map(quoted).join(', ')}): a reference to it reaches only one, and a run keeps one`,
  }));
}
