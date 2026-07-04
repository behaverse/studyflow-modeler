import * as yaml from 'js-yaml';

/** Shared plumbing for both codec directions (`serialize.ts`, `deserialize.ts`). */

export type YamlDoc = Record<string, unknown>;

/** Top-level keys that are not root-element ids (`studyflow`/`elements` are legacy). */
export const RESERVED_DOC_KEYS = new Set(['studyflow', 'id', 'definitions', 'elements', 'diagram']);

export const YAML_DUMP_OPTIONS: yaml.DumpOptions = { noRefs: true, lineWidth: 120, quotingType: '"' };

export function isModdleElement(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && typeof (value as any).$type === 'string';
}

/**
 * Authored value-type of a property. `toModdlePackages` flattens non-attribute
 * value-typed properties' wire type to `String` (so moddle XML-escapes their
 * text) but preserves the original in `valueType`, so YAML detection — which
 * must fold `YAMLString` values but not `MarkdownString` ones — survives the
 * flatten.
 */
export function valueTypeOf(prop: any): string | undefined {
  return prop.valueType ?? prop.type;
}

export function isPrimitiveTypeRef(type: string): boolean {
  return ['String', 'Boolean', 'Integer', 'Real', 'Element'].includes(type);
}

/** The plane of the primary diagram is anchored here when not stated explicitly. */
export function inferPlaneRoot(definitions: any): any | undefined {
  const roots: any[] = definitions.rootElements ?? [];
  return (
    roots.find((root) => root?.$instanceOf?.('bpmn:Collaboration'))
    ?? roots.find((root) => root?.$instanceOf?.('bpmn:Process'))
    ?? roots.find((root) => typeof root?.id === 'string')
  );
}

/**
 * Containment lists whose items all carry unique ids fold into an `id -> body`
 * mapping; the `id` field becomes the key. Returns undefined (keep the list)
 * when any item is id-less.
 */
export function keyItemsById(items: unknown[]): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const { id, ...body } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || id in out) return undefined;
    out[id] = body;
  }
  return out;
}

/** `id -> body` mapping form of a containment list back to a plain list. */
export function keyedMapToList(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>).map(([id, body]) =>
    body && typeof body === 'object' && !Array.isArray(body) ? { id, ...(body as object) } : { id },
  );
}
