import type { SchemaModel } from './model';

const VALUE_TYPE_SUPER_CLASSES = new Set(['String', 'Boolean', 'Integer', 'Float', 'Double']);

/** Qualified names of value types (String subtypes etc.) across all models. */
function collectValueTypes(models: SchemaModel[]): Set<string> {
  const valueTypes = new Set<string>();
  for (const model of models) {
    for (const type of model.types ?? []) {
      if ((type.superClass ?? []).some((sc) => VALUE_TYPE_SUPER_CLASSES.has(sc))) {
        valueTypes.add(`${model.prefix}:${type.name}`);
      }
    }
  }
  return valueTypes;
}

/**
 * moddle back-end: generates the package object the bpmn-moddle XML codec
 * consumes (`moddleExtensions` in bpmn-js, `new BpmnModdle(...)` in the
 * runner's parser).
 *
 * This is the ONLY place that knows moddle's package conventions:
 *
 * - Wrapper types get `Element` appended to `superClass` so instances can
 *   live inside `<bpmn:extensionElements>`. Value types (String subtypes
 *   such as `MarkdownString`) must NOT get it — it breaks nothing today but
 *   they are not elements.
 * - Non-attribute properties typed with a value type are rewritten to plain
 *   `String` on the wire. moddle only stores element text content for the
 *   built-in `String`, so e.g. `isMany` MarkdownString lists
 *   (`inclusionCriteria`, `strata`, `Checklist.items`) silently lost their
 *   text on every load before this rewrite. The catalog keeps the authored
 *   type as the UI hint (markdown editor, YAML editor).
 *
 * The result is a fresh object per call: moddle mutates registered packages
 * in place (qualifying property names), so generated packages must never be
 * shared with the catalog or reused across moddle instances.
 */
export function toModdlePackages(model: SchemaModel, allModels: SchemaModel[] = [model]): any {
  const valueTypes = collectValueTypes(allModels);
  const pkg: any = structuredClone(model);

  for (const type of pkg.types ?? []) {
    const isValueType = valueTypes.has(`${pkg.prefix}:${type.name}`);

    if (!isValueType && Array.isArray(type.superClass) && type.superClass.length > 0
        && !type.superClass.includes('Element')) {
      type.superClass.push('Element');
    }

    for (const property of type.properties ?? []) {
      if (property.isAttr || property.isBody || !property.type) continue;
      const qualified = property.type.includes(':') ? property.type : `${pkg.prefix}:${property.type}`;
      if (valueTypes.has(qualified)) property.type = 'String';
    }
  }

  return pkg;
}
