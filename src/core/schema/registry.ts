import { firstSentence } from '@/core/naming';
import type { SchemaModel } from '@/core/schema';

/**
 * The schema registry — which schemas exist, what they are called, and which
 * are core — derived from the `*.moddle.yaml` files themselves.
 *
 * There is no hand-kept list of schemas anywhere in the app: dropping a new
 * `<prefix>.moddle.yaml` into `assets/schemas` registers it. A schema file
 * declares its own `name`, `description`, `core`, and `order`; everything the
 * settings panel, the loader, and the palette need comes from here.
 *
 * These are pure functions over already-parsed models so they can run both in
 * the app (where the loader supplies the models from the bundle) and in tests
 * (where they are read off disk).
 */

export type SchemaRegistryEntry = {
  prefix: string;
  name: string;
  /** One line for the settings row — the opening sentence of `description`. */
  description: string;
  /** Core schemas back the default elements and cannot be disabled. */
  core: boolean;
  icon?: string;
  uri: string;
};

/** Schemas that declare no `order`, so they sort after the ones that do. */
const UNORDERED = Number.MAX_SAFE_INTEGER;

/**
 * Load and display order: by the schema's declared `order`, then by prefix.
 *
 * Order is not cosmetic — it is also the precedence used when resolving an
 * unqualified type ref, so the core schemas declare an explicit one and every
 * other schema falls in alphabetically behind them.
 */
export function sortSchemas<T extends { prefix: string; order?: number }>(models: T[]): T[] {
  return [...models].sort((a, b) => {
    const byOrder = (a.order ?? UNORDERED) - (b.order ?? UNORDERED);
    return byOrder !== 0 ? byOrder : a.prefix.localeCompare(b.prefix);
  });
}

export function toRegistryEntry(model: SchemaModel): SchemaRegistryEntry {
  return {
    prefix: model.prefix,
    name: model.name?.trim() || model.prefix,
    description: firstSentence(model.description ?? ''),
    core: model.core === true,
    icon: typeof model.icon === 'string' ? model.icon : undefined,
    uri: model.uri,
  };
}

export function buildRegistry(models: SchemaModel[]): SchemaRegistryEntry[] {
  return sortSchemas(models).map(toRegistryEntry);
}

/** Every namespace URI a file may declare for `model`, current spelling first. */
export function schemaUris(model: SchemaModel): string[] {
  return [model.uri].filter(Boolean);
}
