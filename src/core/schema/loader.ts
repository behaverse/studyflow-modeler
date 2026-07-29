import { buildCatalog, setCatalog } from '@/core/catalog';
import { fromModdleYaml, toModdlePackages, type SchemaModel } from '@/core/schema';
import { buildRegistry, sortSchemas, type SchemaRegistryEntry } from '@/core/schema/registry';

/**
 * Every `*.moddle.yaml` in `assets/schemas`, parsed once at startup.
 *
 * The glob is eager because the registry (schema names, blurbs, and the core
 * flag) is read from the files themselves — the settings panel has to list
 * schemas that are switched *off*, so their headers must be present before
 * anything is loaded. The schema files are small next to the modeler itself,
 * and inlining them also removes a request waterfall at boot.
 */
const schemaSources = import.meta.glob('@/assets/schemas/*.moddle.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** All schema models, in registry order (see `sortSchemas`). */
export const SCHEMA_MODELS: SchemaModel[] = sortSchemas(
  Object.values(schemaSources).map((source) => fromModdleYaml(source)),
);

/** The registry every consumer reads: names, blurbs, and the core flag. */
export const SCHEMAS: SchemaRegistryEntry[] = buildRegistry(SCHEMA_MODELS);

export const SCHEMA_NAMES: string[] = SCHEMAS.map((schema) => schema.prefix);

/**
 * Load the listed schemas plus every `core` one.
 *
 * Pipeline: `SchemaModel` -> (a) the compiled catalog the whole app reads,
 * and (b) moddle packages so bpmn-js can read and write the XML. See
 * `src/core/schema/index.ts`.
 */
export async function loadSchemas(prefixes: string[]): Promise<Record<string, any>> {
  const enabled = new Set(prefixes);
  for (const schema of SCHEMAS) if (schema.core) enabled.add(schema.prefix);

  const models = SCHEMA_MODELS.filter((model) => enabled.has(model.prefix));

  setCatalog(buildCatalog(models));
  return Object.fromEntries(models.map((model) => [model.prefix, toModdlePackages(model, models)]));
}

export function loadAllSchemas(): Promise<Record<string, any>> {
  return loadSchemas(SCHEMA_NAMES);
}
