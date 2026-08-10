import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { fromModdleYaml, type SchemaModel } from '../src/core/notation/schemaFile';
import { buildManifest, sortSchemas, type SchemaInfo } from '../src/core/notation/manifest';

/** The Node counterpart of `src/core/notation/loader.ts`, which reads the same files through Vite's bundle. */

export const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');

const SUFFIX = '.moddle.yaml';

export function schemaPrefixes(): string[] {
  return SCHEMA_MODELS.map((model) => model.prefix);
}

export function schemaSource(prefix: string): string {
  return readFileSync(path.join(SCHEMA_DIR, `${prefix}${SUFFIX}`), 'utf8');
}

export const SCHEMA_MODELS: SchemaModel[] = sortSchemas(
  readdirSync(SCHEMA_DIR)
    .filter((file) => file.endsWith(SUFFIX))
    .map((file) => fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, file), 'utf8'))),
);

export const SCHEMAS: SchemaInfo[] = buildManifest(SCHEMA_MODELS);

/** A fresh parse of every schema — moddle mutates the models it is handed. */
export function loadSchemaModels(): SchemaModel[] {
  return sortSchemas(schemaPrefixes().map((prefix) => fromModdleYaml(schemaSource(prefix))));
}
