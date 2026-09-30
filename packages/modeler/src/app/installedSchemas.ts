import { SCHEMAS } from '@core/notation/loader';
import { fromModdleYaml, type SchemaModel } from '@core/notation/moddlePackage';

/**
 * The schemas of the skills installed beside the CLI (`studyflow skill add`): `studyflow edit` serves them as
 * `installed-skills.json` beside the app, and the modeler loads them with its own, always; one whose prefix a shipped
 * schema has is the shipped one's. Where nothing serves the file (the web app, the dev server), there are none.
 */
export type InstalledSchema = { skill: string; description: string; model: SchemaModel };

let installed: InstalledSchema[] = [];

/** The installed schemas the modeler booted with. */
export const installedSchemas = (): InstalledSchema[] => installed;

/** Read the installed schemas the page is served with, once, before the editor boots. */
export async function fetchInstalledSchemas(): Promise<SchemaModel[]> {
  try {
    const response = await fetch(new URL('installed-skills.json', document.baseURI));
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return [];
    const skills = await response.json() as { skill: string; description: string; schema: string; source: string }[];
    installed = skills.flatMap(({ skill, description, schema, source }) => {
      try {
        const model = fromModdleYaml(source, schema);
        return SCHEMAS.some((shipped) => shipped.prefix === model.prefix) ? [] : [{ skill, description, model }];
      } catch (err) {
        console.error(`[studyflow skill] the installed skill ${skill}'s schema ${schema} failed to parse and was not loaded:`, err);
        return [];
      }
    });
  } catch {
    installed = [];
  }
  return installed.map(({ model }) => model);
}
