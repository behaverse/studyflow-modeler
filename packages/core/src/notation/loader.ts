import { buildCatalog, setCatalog } from '@core/notation';
import { fromModdleYaml, toModdlePackages, type SchemaModel } from '@core/notation/schemaFile';
import { buildManifest, sortSchemas, type SchemaInfo } from '@core/notation/manifest';

const schemaSources = import.meta.glob('#assets/schemas/*.moddle.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export type SchemaLoadFailure = { sourceName: string; message: string };

export const SCHEMA_LOAD_FAILURES: SchemaLoadFailure[] = [];

function parseAll(): SchemaModel[] {
  const models: SchemaModel[] = [];
  for (const [path, source] of Object.entries(schemaSources)) {
    const sourceName = path.split('/').pop() ?? path;
    try {
      models.push(fromModdleYaml(source, sourceName));
    } catch (err) {
      SCHEMA_LOAD_FAILURES.push({
        sourceName,
        message: err instanceof Error ? err.message : String(err),
      });
      console.error(`[studyflow schema] ${sourceName} failed to parse and was not loaded:`, err);
    }
  }
  return models;
}

export const SCHEMA_MODELS: SchemaModel[] = sortSchemas(parseAll());

export const SCHEMAS: SchemaInfo[] = buildManifest(SCHEMA_MODELS);

export const SCHEMA_NAMES: string[] = SCHEMAS.map((schema) => schema.prefix);

export async function loadSchemas(prefixes: string[]): Promise<Record<string, any>> {
  const enabled = new Set(prefixes);
  for (const schema of SCHEMAS) if (schema.core) enabled.add(schema.prefix);

  const models = SCHEMA_MODELS.filter((model) => enabled.has(model.prefix));

  const catalog = buildCatalog(models);

  for (const diagnostic of catalog.diagnostics) {
    console.warn(`[studyflow schema] ${diagnostic}`);
  }

  setCatalog(catalog);
  return Object.fromEntries(models.map((model) => [model.prefix, toModdlePackages(model, models)]));
}

export function loadAllSchemas(): Promise<Record<string, any>> {
  return loadSchemas(SCHEMA_NAMES);
}
