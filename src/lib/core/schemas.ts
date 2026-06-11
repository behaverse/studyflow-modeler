import { SCHEMAS } from './constants';
import { buildCatalog, setActiveCatalog } from './catalog';
import { fromModdleYaml, toModdlePackages, type SchemaModel } from './schema';

const schemaFiles = import.meta.glob('@/assets/schemas/*.moddle.yaml', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Load the listed schemas plus any `core: true` schemas.
 *
 * Pipeline: schema text -> IR (`SchemaModel`) -> (a) the compiled catalog the
 * whole app reads, and (b) generated moddle packages for the BPMN XML codec.
 * Swapping the authoring format (e.g. LinkML) only changes the front-end
 * call here; see `src/lib/core/schema`.
 */
export async function loadSchemas(prefixes: string[]): Promise<Record<string, any>> {
  const enabled = new Set(prefixes);
  for (const s of SCHEMAS) if (s.core) enabled.add(s.prefix);

  const models: SchemaModel[] = [];
  for (const { prefix } of SCHEMAS) {
    if (!enabled.has(prefix)) continue;
    const url = schemaFiles[`/assets/schemas/${prefix}.moddle.yaml`];
    if (!url) throw new Error(`Schema not found in bundle: ${prefix}`);
    const text = await (await fetch(url)).text();
    models.push(fromModdleYaml(text));
  }

  setActiveCatalog(buildCatalog(models));
  return Object.fromEntries(models.map((model) => [model.prefix, toModdlePackages(model, models)]));
}

export function loadAllSchemas(): Promise<Record<string, any>> {
  return loadSchemas(SCHEMAS.map((s) => s.prefix));
}
