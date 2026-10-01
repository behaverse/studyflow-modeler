import type { Issue } from '@core/checks';
import { getCatalog, hasCatalog } from '@core/notation';
import type { StudyModel } from '@core/model/index';

/** The schema's scalar types a value is checked against, by what reads as one. */
const SCALARS: Record<string, { test: RegExp; is: string }> = {
  Integer: { test: /^[-+]?\d+$/, is: 'a whole number' },
  Real: { test: /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/, is: 'a number' },
  Boolean: { test: /^(true|false)$/, is: 'true or false' },
};

/**
 * An attribute holds a value of the type its schema gives it: one of an enumeration's values (`algorithm: block`,
 * never `blocks`), a whole number, a number, or true or false. A runner reads the value, and one it cannot read is a
 * setting it quietly does not apply. An enumeration whose attribute is marked `editable` offers values, and takes
 * others too; a `{placeholder}` is read at run time.
 */
export function checkValues(model: StudyModel): Issue[] {
  if (!hasCatalog()) return [];
  const catalog = getCatalog();
  const issues: Issue[] = [];
  for (const element of model.all()) {
    const id = model.ownerOf(element);
    for (const [key, value] of Object.entries(element)) {
      const property = key === 'type' ? undefined : model.propertyAt(element, key);
      if (!property || property.isReference || value === undefined || value === null) continue;
      // The type that declares it: an extension entry's own, a typed element's schema type for what its BPMN element
      // lacks, else its BPMN element's.
      const host = model.host(element);
      const entry = model.holderOf(element)?.key === 'extensionElements';
      const type = entry || (host !== element.type && !model.metamodel.property(host, key)) ? element.type : host;
      const scalar = SCALARS[property.type];
      for (const held of scalar ? [value].flat() : []) {
        if (typeof held !== 'string' || held.includes('{') || scalar.test.test(held.trim())) continue;
        issues.push({ severity: 'error', elementId: id, message: `${JSON.stringify(id)} has ${property.ns.localName}: ${JSON.stringify(held)}, which is not ${scalar.is}` });
      }
      const choices = catalog.enumOf(property.type, type.split(':')[0]);
      const spec = catalog.instanceAttributesOf(type).find((candidate) => candidate.name === property.name || candidate.name === property.ns.name);
      if (!choices || (spec?.meta as { editable?: boolean } | undefined)?.editable) continue;
      const allowed = choices.literals.map((literal) => literal.value);
      for (const held of [value].flat()) {
        if (typeof held !== 'string' || held.includes('{') || allowed.includes(held)) continue;
        issues.push({
          severity: 'error',
          elementId: id,
          message: `${JSON.stringify(id)} has ${property.ns.localName}: ${JSON.stringify(held)}, which ${choices.name} does not list (${allowed.join(', ')})`,
        });
      }
    }
  }
  return issues;
}
