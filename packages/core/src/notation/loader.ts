import { buildCatalog, setCatalog } from '@core/notation';
import { fromModdleYaml, toModdlePackages, type SchemaModel } from '@core/notation/moddlePackage';
import { buildManifest, sortSchemas, type SchemaInfo } from '@core/notation/manifest';
import { parseSkillManifest, type SkillManifest } from '@core/notation/skill';

/** Every skill is a folder with a `SKILL.md`; its front matter says what the skill contributes. */
const manifestSources = import.meta.glob('@skills/*/SKILL.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Every YAML under the skills but their examples, by path; a skill's `schema` picks its own out of these. */
const yamlSources = import.meta.glob(['@skills/*/**/*.yaml', '!**/examples/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export type SchemaLoadFailure = { sourceName: string; message: string };

export const SCHEMA_LOAD_FAILURES: SchemaLoadFailure[] = [];

function readSkills(): SkillManifest[] {
  const skills: SkillManifest[] = [];
  for (const [path, source] of Object.entries(manifestSources)) {
    const folder = path.split('/').at(-2);
    try {
      skills.push(parseSkillManifest(source, folder));
    } catch (err) {
      SCHEMA_LOAD_FAILURES.push({ sourceName: `${folder ?? path}/SKILL.md`, message: err instanceof Error ? err.message : String(err) });
      console.error(`[studyflow skill] ${folder ?? path}/SKILL.md failed to parse and was not loaded:`, err);
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export const SKILLS: SkillManifest[] = readSkills();

const skillOfPrefix = new Map<string, SkillManifest>();

function parseAll(): SchemaModel[] {
  const models: SchemaModel[] = [];
  for (const skill of SKILLS) for (const schema of skill.schemas) {
    const sourceName = `${skill.name}/${schema}`;
    const key = Object.keys(yamlSources).find((path) => path.endsWith(`/${sourceName}`));
    const source = key ? yamlSources[key] : undefined;
    if (!source) {
      SCHEMA_LOAD_FAILURES.push({ sourceName, message: `SKILL.md declares this schema, but there is no such file` });
      console.error(`[studyflow skill] ${sourceName} is declared but missing`);
      continue;
    }
    try {
      const model = fromModdleYaml(source, sourceName);
      skillOfPrefix.set(model.prefix, skill);
      models.push(model);
    } catch (err) {
      SCHEMA_LOAD_FAILURES.push({ sourceName, message: err instanceof Error ? err.message : String(err) });
      console.error(`[studyflow schema] ${sourceName} failed to parse and was not loaded:`, err);
    }
  }
  return models;
}

export const SCHEMA_MODELS: SchemaModel[] = sortSchemas(parseAll());

export const SCHEMAS: SchemaInfo[] = buildManifest(SCHEMA_MODELS);

export const SCHEMA_NAMES: string[] = SCHEMAS.map((schema) => schema.prefix);

/** The skill a schema prefix belongs to. */
export function skillOfSchema(prefix: string): SkillManifest | undefined {
  return skillOfPrefix.get(prefix);
}

/** The shipped schemas `prefixes` names (the required ones always), with `installed`, the schemas of skills installed
 * beside the app (`studyflow skill add`), which load whenever given. */
export async function loadSchemas(prefixes: string[], installed: SchemaModel[] = []): Promise<Record<string, any>> {
  const enabled = new Set(prefixes);
  for (const schema of SCHEMAS) if (schema.required) enabled.add(schema.prefix);

  const shipped = new Set(SCHEMA_MODELS.map((model) => model.prefix));
  const models = sortSchemas([
    ...SCHEMA_MODELS.filter((model) => enabled.has(model.prefix)),
    ...installed.filter((model) => !shipped.has(model.prefix)),
  ]);

  const catalog = buildCatalog(models);

  for (const diagnostic of catalog.diagnostics) {
    console.warn(`[studyflow schema] ${diagnostic}`);
  }

  setCatalog(catalog);
  return Object.fromEntries(models.map((model) => [model.prefix, toModdlePackages(model, models)]));
}

export function loadAllSchemas(installed: SchemaModel[] = []): Promise<Record<string, any>> {
  return loadSchemas(SCHEMA_NAMES, installed);
}
