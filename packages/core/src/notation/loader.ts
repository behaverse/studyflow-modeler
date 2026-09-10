import { buildCatalog, setCatalog } from '@core/notation';
import { fromModdleYaml, toModdlePackages, type SchemaModel } from '@core/notation/schemaFile';
import { buildManifest, sortSchemas, type SchemaInfo } from '@core/notation/manifest';
import { isCoreSkill, parseSkillManifest, type SkillManifest } from '@core/notation/skill';

/** Every skill is a folder with a `SKILL.md`; its front matter says what the skill contributes. */
const manifestSources = import.meta.glob('@skills/*/SKILL.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Every YAML under the skills, by path; a skill's `schema` picks its own out of these. */
const yamlSources = import.meta.glob('@skills/*/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export type SchemaLoadFailure = { sourceName: string; message: string };

export const SCHEMA_LOAD_FAILURES: SchemaLoadFailure[] = [];

function readSkills(): SkillManifest[] {
  const skills: SkillManifest[] = [];
  for (const [path, source] of Object.entries(manifestSources)) {
    // `/SKILL.md` when the bundling app's own root is a skill folder (the browser runtime): no folder to check against.
    const folder = path.split('/').at(-2) || undefined;
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
  for (const skill of SKILLS) {
    if (!skill.schema) continue;
    const sourceName = `${skill.name}/${skill.schema}`;
    // `/<schema>` when the bundling app's own root is this skill's folder (the browser runtime), as with `/SKILL.md` above.
    const key = Object.keys(yamlSources).find((path) => path.endsWith(`/${sourceName}`) || path === `/${skill.schema}`);
    if (!key) {
      SCHEMA_LOAD_FAILURES.push({ sourceName, message: `SKILL.md declares this schema, but there is no such file` });
      console.error(`[studyflow skill] ${sourceName} is declared but missing`);
      continue;
    }
    try {
      const model = fromModdleYaml(yamlSources[key], sourceName);
      model.core = isCoreSkill(skill.name); // the apps know which skills they cannot run without
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

export async function loadSchemas(prefixes: string[]): Promise<Record<string, any>> {
  const enabled = new Set(prefixes);
  for (const schema of SCHEMAS) if (schema.core) enabled.add(schema.prefix);

  const models = SCHEMA_MODELS.filter((model) => enabled.has(model.prefix));

  const catalog = buildCatalog(models);

  for (const diagnostic of catalog.diagnostics) {
    console.warn(`[studyflow schema] ${diagnostic}`);
  }

  setCatalog(catalog);
  return Object.fromEntries(models.map((model) => [model.prefix, toModdlePackages(model, models)]));
}

export function loadAllSchemas(): Promise<Record<string, any>> {
  return loadSchemas(SCHEMA_NAMES);
}
