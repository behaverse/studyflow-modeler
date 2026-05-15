import { SCHEMAS } from '../../constants';
import { getSettings } from '../../settings/store';
import { loadSchemas } from '@/lib/core/schemas';

export type DownloadSchemasCommand = {
  type: 'download-schemas';
};

export async function runDownloadSchemas(_command: DownloadSchemasCommand): Promise<Record<string, any>> {
  const enabled = new Set(getSettings().enabledSchemas);
  for (const schema of SCHEMAS) {
    if (schema.core) enabled.add(schema.prefix);
  }
  return loadSchemas(Array.from(enabled));
}
