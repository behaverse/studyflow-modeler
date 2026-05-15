import { SCHEMAS } from './constants';
import { toModelerModdleSchema } from './parsers/moddle-schema';

const schemaFiles = import.meta.glob('@/assets/schemas/*.moddle.yaml', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Load the listed schemas plus any flagged `core: true`. Caller decides which
// non-core schemas to include.
export async function loadSchemas(prefixes: string[]): Promise<Record<string, any>> {
  const enabled = new Set(prefixes);
  for (const s of SCHEMAS) if (s.core) enabled.add(s.prefix);

  const out: Record<string, any> = {};
  for (const { prefix } of SCHEMAS) {
    if (!enabled.has(prefix)) continue;
    const url = schemaFiles[`/assets/schemas/${prefix}.moddle.yaml`];
    if (!url) throw new Error(`Schema not found in bundle: ${prefix}`);
    const text = await (await fetch(url)).text();
    out[prefix] = toModelerModdleSchema(text);
  }
  return out;
}

export function loadAllSchemas(): Promise<Record<string, any>> {
  return loadSchemas(SCHEMAS.map((s) => s.prefix));
}
