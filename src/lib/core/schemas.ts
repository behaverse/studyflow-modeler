import { SCHEMAS } from './constants';
import { buildCatalog, setCatalog } from './catalog';
import { fromModdleYaml, toModdlePackages, type SchemaModel } from './schema';

const schemaFiles = import.meta.glob('@/assets/schemas/*.moddle.yaml', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

/**
 * Load the listed schemas plus any `core: true` schemas.
 *
 * Pipeline: schema text -> `SchemaModel` -> (a) the compiled catalog the
 * whole app reads, and (b) moddle packages so bpmn-js can read and write the
 * XML. See `src/lib/core/schema.ts`.
 */
export async function loadSchemas(prefixes: string[]): Promise<Record<string, any>> {
  const enabled = new Set(prefixes);
  for (const s of SCHEMAS) if (s.core) enabled.add(s.prefix);

  const models: SchemaModel[] = [];
  for (const { prefix } of SCHEMAS) {
    if (!enabled.has(prefix)) continue;
    const load = schemaFiles[`/assets/schemas/${prefix}.moddle.yaml`];
    if (!load) throw new Error(`Schema not found in bundle: ${prefix}`);
    models.push(fromModdleYaml(await load()));
  }

  setCatalog(buildCatalog(models));
  return Object.fromEntries(models.map((model) => [model.prefix, toModdlePackages(model, models)]));
}

export function loadAllSchemas(): Promise<Record<string, any>> {
  return loadSchemas(SCHEMAS.map((s) => s.prefix));
}
