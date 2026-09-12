import * as yaml from 'js-yaml';
import { buildCatalog, setCatalog } from '@core/notation';
import { fromLinkml, parseLinkml, type LinkmlSchema } from '@core/notation/linkml';
import { toModdlePackages, type SchemaModel } from '@core/notation/schemaFile';
import { buildManifest, sortSchemas, type SchemaInfo } from '@core/notation/manifest';
import { parseSkillManifest, type SkillManifest } from '@core/notation/skill';

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

function skillFile(skill: SkillManifest, name: string): string | undefined {
  const key = Object.keys(yamlSources).find((path) => path.endsWith(`/${skill.name}/${name}`));
  return key ? yamlSources[key] : undefined;
}

/** `templates.yaml` and `examples.yaml` beside the schema: content a skill ships, which a LinkML schema cannot carry. */
function sidecar<T>(skill: SkillManifest, name: string): T[] {
  const source = skillFile(skill, name);
  if (!source) return [];
  try {
    const parsed = yaml.load(source);
    if (!Array.isArray(parsed)) throw new Error('expected a list');
    return parsed as T[];
  } catch (err) {
    SCHEMA_LOAD_FAILURES.push({ sourceName: `${skill.name}/${name}`, message: err instanceof Error ? err.message : String(err) });
    console.error(`[studyflow skill] ${skill.name}/${name} failed to parse and was not loaded:`, err);
    return [];
  }
}

function parseAll(): SchemaModel[] {
  const parsed: Array<{ skill: SkillManifest; doc: LinkmlSchema }> = [];
  for (const skill of SKILLS) {
    if (!skill.schema) continue;
    const sourceName = `${skill.name}/${skill.schema}`;
    // `/<schema>` when the bundling app's own root is this skill's folder (the browser runtime), as with `/SKILL.md` above.
    const source = skillFile(skill, skill.schema) ?? yamlSources[`/${skill.schema}`];
    if (!source) {
      SCHEMA_LOAD_FAILURES.push({ sourceName, message: `SKILL.md declares this schema, but there is no such file` });
      console.error(`[studyflow skill] ${sourceName} is declared but missing`);
      continue;
    }
    try {
      parsed.push({ skill, doc: parseLinkml(source, sourceName) });
    } catch (err) {
      SCHEMA_LOAD_FAILURES.push({ sourceName, message: err instanceof Error ? err.message : String(err) });
      console.error(`[studyflow schema] ${sourceName} failed to parse and was not loaded:`, err);
    }
  }

  // Converted together: a name another schema declares resolves to it, as LinkML resolves an import.
  const models = fromLinkml(parsed.map((entry) => entry.doc));
  return models.map((model, index) => {
    const { skill } = parsed[index];
    skillOfPrefix.set(model.prefix, skill);
    return { ...model, templates: sidecar(skill, 'templates.yaml'), examples: sidecar(skill, 'examples.yaml') };
  });
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
