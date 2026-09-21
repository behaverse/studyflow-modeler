import * as yaml from 'js-yaml';

import { StudyflowElement, getAttribute } from '@core/element';
import type { ModdleElement } from '@core/element/moddle';
import { parseSchemaBody } from '@core/document/schema-body';
import type { Issue } from '@core/checks';
import { containers, quoted } from '@core/checks/graph';

/** The top-level `additionalArguments` keys whose values name columns of the table a step reads, as pandas spells them. */
const COLUMN_ARGUMENTS = ['index', 'columns', 'values', 'subset', 'by', 'key', 'column', 'on', 'usecols'];

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
function schemaOf(source: ModdleElement, byId: Map<string, ModdleElement>): { name: string; columns: string[] } | undefined {
  const id = getAttribute(source, 'schema');
  const schema = typeof id === 'string' ? byId.get(id) : undefined;
  if (!schema || !StudyflowElement.fromBusinessObject(schema).extension?.$instanceOf?.('studyflow:Schema')) return undefined;
  const body = getAttribute(schema, 'body');
  const columns = parseSchemaBody(typeof body === 'string' ? body : '').columns.map((column) => column.name);
  return columns.length > 0 ? { name: schema.name || schema.id, columns } : undefined;
}

/** The column names a step's arguments pass under {@link COLUMN_ARGUMENTS}: a string, or a list of strings. */
function columnArguments(step: ModdleElement): string[] {
  const text = getAttribute(step, 'additionalArguments');
  let args: any;
  try {
    args = typeof text === 'string' ? yaml.load(text) : undefined;
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
export function checkDataContract(definitions: ModdleElement): Issue[] {
  const byId = new Map<string, ModdleElement>();
  const all = containers(definitions).flatMap((container) => container.flowElements ?? []);
  for (const element of all) if (typeof element.id === 'string') byId.set(element.id, element);

  const issues: Issue[] = [];
  for (const step of all) {
    const sources = new Set<ModdleElement>((step.dataInputAssociations ?? []).flatMap((association: any) => association.sourceRef ?? []));
    const schemas = [...sources].map((source) => schemaOf(source, byId)).filter((schema) => schema !== undefined);
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
