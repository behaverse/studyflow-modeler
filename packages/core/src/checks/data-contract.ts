import * as yaml from 'js-yaml';

import { parseSchemaBody } from '@core/document/schema-body';
import type { Issue } from '@core/checks';
import { containers, quoted } from '@core/checks/graph';
import { idOf, isElement, yamlText, type Element, type StudyModel } from '@core/model/index';

/** The top-level `additionalArguments` keys whose values name columns of the table a step reads, as pandas spells them,
 * and as statistics libraries name a test's variables in a long table (pingouin's `dv`, `within`, `between`, `subject`). */
const COLUMN_ARGUMENTS = ['index', 'columns', 'values', 'subset', 'by', 'key', 'column', 'on', 'usecols', 'dv', 'within', 'between', 'subject'];

/** Levenshtein distance, one row at a time. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** The column spelled most like `name`, when it differs in at most half the letters of the longer of the two. */
function closest(name: string, columns: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const column of columns) {
    const d = distance(name, column);
    if (d < bestDistance) [best, bestDistance] = [column, d];
  }
  return best !== undefined && bestDistance <= Math.max(name.length, best.length) / 2 ? best : undefined;
}

/** A source's schema: its `schema` names a `studyflow:Schema` whose body declares columns. */
function schemaOf(model: StudyModel, source: Element): { name: string; columns: string[] } | undefined {
  const schema = model.get(idOf(model.attribute(source, 'schema')) ?? undefined);
  if (!schema || model.extensionType(schema) !== 'studyflow:Schema') return undefined;
  const columns = parseSchemaBody(yamlText(model.attribute(schema, 'body')) ?? '').columns.map((column) => column.name);
  return columns.length > 0 ? { name: String(schema.name || schema.id), columns } : undefined;
}

/** The column names a step's arguments pass under {@link COLUMN_ARGUMENTS}: a string, or a list of strings. */
function columnArguments(step: Element): string[] {
  const text = yamlText(step.additionalArguments);
  let args: any;
  try {
    args = text === undefined ? undefined : yaml.load(text);
  } catch {
    return [];
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  return COLUMN_ARGUMENTS.flatMap((key) => [args[key]].flat()).filter((name): name is string => typeof name === 'string');
}

/**
 * The data contract: a step that reads data bound to a schema names, in its arguments, only columns that schema
 * defines. A name with a `{placeholder}` is filled in at run time, so it is not checked; nor is data no schema is
 * bound to, or a column a step derives.
 */
export function checkDataContract(model: StudyModel): Issue[] {
  const all = containers(model).flatMap((container) => (Array.isArray(container.flowElements) ? container.flowElements : []).filter(isElement));
  const issues: Issue[] = [];
  for (const step of all) {
    const associations = (Array.isArray(step.dataInputAssociations) ? step.dataInputAssociations : []).filter(isElement);
    const sources = new Set(associations.flatMap((association) => (Array.isArray(association.sourceRef) ? association.sourceRef : []))
      .map((ref) => model.get(idOf(ref) ?? undefined)).filter((source): source is Element => !!source));
    const schemas = [...sources].map((source) => schemaOf(model, source)).filter((schema) => schema !== undefined);
    const names = schemas.length > 0 ? columnArguments(step) : [];
    for (const schema of schemas) {
      for (const name of names) {
        if (schema.columns.includes(name) || name.includes('{')) continue;
        const near = closest(name, schema.columns);
        issues.push({
          severity: 'error',
          elementId: step.id,
          message: `${quoted(step)} reads column "${name}", which schema "${schema.name}" does not define${near ? ` (closest: "${near}")` : ''}`,
        });
      }
    }
  }
  return issues;
}
