import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { fromModdleYaml, type SchemaModel } from '../src/core/schema';
import { buildRegistry, sortSchemas, type SchemaRegistryEntry } from '../src/core/schema/registry';

/**
 * The schema files, read off disk.
 *
 * The Node counterpart of `src/core/schema/loader.ts`, which reads the same
 * files through Vite's bundle. Neither side has a list of schemas: both
 * enumerate the directory, so a new `*.moddle.yaml` is picked up by the app
 * and by every test that walks the schemas without either being edited.
 */

export const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');

const SUFFIX = '.moddle.yaml';

/** Prefixes of every schema file present, in registry order. */
export function schemaPrefixes(): string[] {
  return SCHEMA_MODELS.map((model) => model.prefix);
}

export function schemaSource(prefix: string): string {
  return readFileSync(path.join(SCHEMA_DIR, `${prefix}${SUFFIX}`), 'utf8');
}

/** Every schema model, in the same order the app loads them. */
export const SCHEMA_MODELS: SchemaModel[] = sortSchemas(
  readdirSync(SCHEMA_DIR)
    .filter((file) => file.endsWith(SUFFIX))
    .map((file) => fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, file), 'utf8'))),
);

/** The registry the settings panel renders, derived exactly as the app does. */
export const SCHEMAS: SchemaRegistryEntry[] = buildRegistry(SCHEMA_MODELS);

/** A fresh parse of every schema — moddle mutates the models it is handed. */
export function loadSchemaModels(): SchemaModel[] {
  return sortSchemas(schemaPrefixes().map((prefix) => fromModdleYaml(schemaSource(prefix))));
}
