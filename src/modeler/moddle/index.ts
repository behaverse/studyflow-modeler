import * as yaml from 'js-yaml';

import type { ModdleSchema } from './types';

/**
 * Modeler-only adapter: parse a moddle YAML schema into the JSON package
 * shape expected by bpmn-moddle.
 *
 * Ensures every concrete type with a superClass also extends moddle's `Element`,
 * so the type can be used as a child of `bpmn:ExtensionElements` (whose `values`
 * property is typed `Element`). Without this, bpmn-moddle's writer happily
 * serializes the wrapper but the parser rejects it on re-load with
 * "unrecognized element".
 */
export function toModelerModdleSchema(moddleYamlContent: string): ModdleSchema {
  const schema = yaml.load(moddleYamlContent);

  assertModdleSchema(schema);

  for (const type of schema.types ?? []) {
    if (Array.isArray(type.superClass) && type.superClass.length > 0
        && !type.superClass.includes('Element')) {
      type.superClass.push('Element');
    }
  }

  return schema;
}

export type { ModdleSchema };

function assertModdleSchema(value: unknown): asserts value is ModdleSchema {
  if (!isRecord(value)) {
    throw new Error('Invalid moddle schema: expected a YAML object.');
  }

  for (const key of ['name', 'uri', 'prefix']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new Error(`Invalid moddle schema: missing ${key}.`);
    }
  }

  if (!isRecord(value.xml) || typeof value.xml.tagAlias !== 'string') {
    throw new Error('Invalid moddle schema: missing xml.tagAlias.');
  }

  for (const key of ['associations', 'enumerations', 'types']) {
    if (!Array.isArray(value[key])) {
      throw new Error(`Invalid moddle schema: ${key} must be an array.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
