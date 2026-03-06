import { toModelerModdleSchema } from '../moddle';
import { SCHEMA_NAMES } from '../contexts';

export type DownloadSchemasCommand = {
  type: 'download-schemas';
};

// TODO fixme use remote schema urls instead of embedding files in the bundle
const schemaFiles = import.meta.glob('@/assets/schemas/*.linkml.yaml', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export async function runDownloadSchemas(command: DownloadSchemasCommand): Promise<Record<string, any>> {
  const downloadedSchemas: Record<string, any> = {};
  void command;

  for (const schemaName of SCHEMA_NAMES) {
    const url = schemaFiles[`/assets/schemas/${schemaName}.linkml.yaml`];
    if (!url) {
      throw new Error(`Schema not found in bundle: ${schemaName}`);
    }

    const response = await fetch(url);
    const text = await response.text();
    downloadedSchemas[schemaName] = toModelerModdleSchema(text);
  }

  return downloadedSchemas;
}
