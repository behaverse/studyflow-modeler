import type { Issue } from '@core/checks';
import { containers, graphOf } from '@core/checks/graph';
import { cited } from '@core/expression/feel';
import { expressionOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index';

const list = (value: Value | undefined): Element[] => (Array.isArray(value) ? value : [value]).filter(isElement);

/** `result.<field>`, with what a filter or an index picks of it, and the field read from that: `result.blocks[…].trials`. */
const PATH = /\bresult\.([A-Za-z_]\w*)(?:\[[^\]]*\])*(?:\.([A-Za-z_]\w*))?/g;

/** A type a schema names, qualified by the prefix of the type that names it when it has none (`TaskResult`). */
const qualified = (name: string, by: string): string => (name.includes(':') ? name : `${by.split(':')[0]}:${name}`);

/**
 * A data edge's `transformation` reads its step's result as `result`. Where the step's type declares what that result
 * holds (its schema's `meta.result`, a type of that schema), a field the result does not carry would only read as null
 * once the study runs, so it is reported before: `result.blocks[block in scored_blocks].trials` against a
 * `behaverse:TaskResult`, its `blocks` a list of `BlockCounts`. A type that declares no result is not checked.
 */
export function checkResults(model: StudyModel): Issue[] {
  const issues: Issue[] = [];
  const holds = (type: string): string => model.metamodel.descriptor(type).properties.map((p) => p.ns.localName).join(', ');
  for (const container of containers(model)) {
    for (const { node } of graphOf(model, container).nodes.values()) {
      const type = model.extensionType(node);
      const declared = type ? model.metamodel.type(type)?.meta.result : undefined;
      if (!type || typeof declared !== 'string' || typeof node.id !== 'string') continue;
      const result = qualified(declared, type);
      if (!model.metamodel.has(result)) continue;
      for (const edge of list(node.dataOutputAssociations)) {
        const body = expressionOf(edge.transformation)?.body;
        if (!body) continue;
        const code = cited(body).replace(/"(?:[^"\\]|\\.)*"/g, '""');
        for (const [, field, inner] of code.matchAll(PATH)) {
          const property = model.metamodel.property(result, field);
          if (!property) {
            issues.push({ severity: 'error', elementId: node.id, message: `${JSON.stringify(node.id)} reads result.${field}, which a ${result} does not hold (it holds ${holds(result)})` });
            continue;
          }
          const item = qualified(property.type, result);
          if (inner && model.metamodel.has(item) && !model.metamodel.property(item, inner)) {
            issues.push({ severity: 'error', elementId: node.id, message: `${JSON.stringify(node.id)} reads ${inner} of result.${field}, whose ${item} does not hold it (it holds ${holds(item)})` });
          }
        }
      }
    }
  }
  return issues;
}
