import { toModelerModdleSchema } from '../../moddle';
import { SCHEMA_NAMES, SCHEMAS } from '../../constants';
import { getSettings } from '../../settings/store';

export type DownloadSchemasCommand = {
  type: 'download-schemas';
};

const schemaFiles = import.meta.glob('@/assets/schemas/*.moddle.yaml', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export async function runDownloadSchemas(command: DownloadSchemasCommand): Promise<Record<string, any>> {
  void command;
  const downloadedSchemas: Record<string, any> = {};
  const enabled = new Set(getSettings().enabledSchemas);
  // Core schemas are always loaded - they back default elements (Study, StartEvent, EndEvent).
  for (const schema of SCHEMAS) {
    if (schema.core) enabled.add(schema.prefix);
  }

  for (const schemaName of SCHEMA_NAMES) {
    if (!enabled.has(schemaName)) continue;
    const url = schemaFiles[`/assets/schemas/${schemaName}.moddle.yaml`];
    if (!url) {
      throw new Error(`Schema not found in bundle: ${schemaName}`);
    }

    const response = await fetch(url);
    const text = await response.text();
    downloadedSchemas[schemaName] = toModelerModdleSchema(text);
  }

  return downloadedSchemas;
}
