import * as yaml from 'js-yaml';

import type { ModdleSchema } from './types';

/**
 * Modeler-only adapter: parse a moddle YAML schema into the JSON package
 * shape expected by bpmn-moddle.
 */
export function toModelerModdleSchema(moddleYamlContent: string): ModdleSchema {
  const schema = yaml.load(moddleYamlContent);

  assertModdleSchema(schema);

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
