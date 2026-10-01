import type { Element, StudyModel } from '@core/model/index';
import { toLocalName } from '@core/naming';

/** How the inspected element names itself: its schema type when it has one, else its BPMN type. */
export function getTypeName(model: StudyModel, element: Element): string {
  return model.extensionType(element) || model.host(element) || '';
}

export function resolveDisplayName(model: StudyModel, element: Element): string {
  const name = model.attribute(element, 'name');
  if (typeof name === 'string' && name.trim()) return name;

  const type = getTypeName(model, element);
  if (type.includes(':')) return toLocalName(type) ?? type;
  return type || 'Unknown';
}

/** A React key for "this inspected element" that survives its own edits: the study model's element is another
 * object after each one, so it is its id. */
export function elementKey(element: { id?: unknown } | null | undefined): string {
  return element && typeof element.id === 'string' ? `el:${element.id}` : 'none';
}
