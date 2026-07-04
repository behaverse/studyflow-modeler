import { getSettings } from '../../settings/store';
import { loadSchemas } from '@/lib/core/schema/loader';

export type DownloadSchemasCommand = {
  type: 'download-schemas';
};

/** `loadSchemas` always includes core schemas; forward the user's enabled list. */
export async function runDownloadSchemas(_modeler: any, _command: DownloadSchemasCommand): Promise<Record<string, any>> {
  return loadSchemas(getSettings().enabledSchemas);
}
