import { isElement, yamlText, type Element, type StudyModel, type Value } from '@core/model/index';
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

/**
 * What `element` holds under the attribute `name` (`bpmn:name`, `studyflow:checklist`), as a field shows it: its value
 * or its schema's default, documentation as one text, a YAML-typed value as its text.
 */
export function readAttribute(model: StudyModel, element: Element | undefined, name: string): any {
  if (!element) return undefined;
  const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
  const value: Value | undefined = model.attributeOrDefault(element, local);
  if (local === 'documentation' && Array.isArray(value)) {
    const texts = value.map((entry) => (isElement(entry) ? entry.text : entry)).filter((text): text is string => typeof text === 'string');
    return texts.length > 0 ? texts.join('\n\n') : undefined;
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && !isElement(value)) return yamlText(value);
  return value;
}
