import { getSettings } from '@/modeler/infra/settings/store';
import { loadSchemas } from '@/core/schema/loader';

export type DownloadSchemasCommand = {
  type: 'download-schemas';
};

/** `loadSchemas` always includes core schemas; forward the user's enabled list. */
export async function runDownloadSchemas(_modeler: any, _command: DownloadSchemasCommand): Promise<Record<string, any>> {
  return loadSchemas(getSettings().enabledSchemas);
}
