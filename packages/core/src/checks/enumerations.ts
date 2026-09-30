import type { ModdleElement } from '@core/element/moddle';
import type { Issue } from '@core/checks';
import { getCatalog, hasCatalog } from '@core/notation';

/**
 * An attribute a schema types by an enumeration holds one of its values (`algorithm: block`, never `blocks`): a
 * runner reads the value, and one it does not know is a setting it quietly does not apply. An enumeration whose
 * attribute is marked `editable` offers values, and takes others too; a `{placeholder}` is read at run time.
 */
export function checkEnumerations(definitions: ModdleElement): Issue[] {
  if (!hasCatalog()) return [];
  const catalog = getCatalog();
  const issues: Issue[] = [];
  const seen = new Set<unknown>();
  const visit = (element: ModdleElement, owner?: string): void => {
    if (!element || typeof element !== 'object' || seen.has(element)) return;
    seen.add(element);
    const id = typeof element.id === 'string' ? element.id : owner;
    const specs = new Map(catalog.instanceAttributesOf(element.$type).map((spec) => [spec.name, spec]));
    for (const property of element.$descriptor?.properties ?? []) {
      const value = element[property.name];
      if (property.isReference || value === undefined || value === null) continue;
      if (Array.isArray(value)) value.forEach((item) => visit(item, id));
      else if (typeof value === 'object' && '$type' in value) visit(value, id);
      const choices = catalog.enumOf(property.type, element.$type?.split(':')[0]);
      const spec = specs.get(property.name) ?? specs.get(property.ns?.name);
      if (!choices || (spec?.meta as { editable?: boolean } | undefined)?.editable) continue;
      const allowed = choices.literals.map((literal) => literal.value);
      for (const held of [value].flat()) {
        if (typeof held !== 'string' || held.includes('{') || allowed.includes(held)) continue;
        issues.push({
          severity: 'error',
          elementId: id,
          message: `${JSON.stringify(id)} has ${property.ns?.localName ?? property.name}: ${JSON.stringify(held)}, which ${choices.name} does not list (${allowed.join(', ')})`,
        });
      }
    }
  };
  visit(definitions);
  return issues;
}
