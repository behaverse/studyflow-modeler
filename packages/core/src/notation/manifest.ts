import { firstSentence } from '@core/naming';
import type { SchemaModel } from '@core/notation/schemaFile';

export type SchemaInfo = {
  prefix: string;
  name: string;
  description: string;
  core: boolean;
  icon?: string;
  uri: string;
};

const UNORDERED = Number.MAX_SAFE_INTEGER;

export function sortSchemas<T extends { prefix: string; order?: number }>(models: T[]): T[] {
  return [...models].sort((a, b) => {
    const byOrder = (a.order ?? UNORDERED) - (b.order ?? UNORDERED);
    return byOrder !== 0 ? byOrder : a.prefix.localeCompare(b.prefix);
  });
}

function toSchemaInfo(model: SchemaModel): SchemaInfo {
  return {
    prefix: model.prefix,
    name: model.name?.trim() || model.prefix,
    description: firstSentence(model.description ?? ''),
    core: model.core === true,
    icon: typeof model.icon === 'string' ? model.icon : undefined,
    uri: model.uri,
  };
}

export function buildManifest(models: SchemaModel[]): SchemaInfo[] {
  return sortSchemas(models).map(toSchemaInfo);
}
