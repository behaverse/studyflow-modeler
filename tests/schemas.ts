import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { fromModdleYaml, toModdlePackages, type SchemaModel } from '@core/notation/schemaFile';
import { buildManifest, sortSchemas, type SchemaInfo } from '@core/notation/manifest';
import { isCoreSkill, parseSkillManifest, type SkillManifest } from '@core/notation/skill';

/** The Node counterpart of `packages/core/src/notation/loader.ts`, which reads the same files through Vite's bundle. */

export const SKILLS_DIR = path.join(process.cwd(), 'skills');

/** Every `skills/<name>/SKILL.md`, parsed. */
export const SKILLS: SkillManifest[] = readdirSync(SKILLS_DIR)
  .filter((name) => existsSync(path.join(SKILLS_DIR, name, 'SKILL.md')))
  .map((name) => parseSkillManifest(readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8'), name))
  .sort((a, b) => a.name.localeCompare(b.name));

function readModel(skill: SkillManifest): SchemaModel {
  const model = fromModdleYaml(readFileSync(path.join(SKILLS_DIR, skill.name, skill.schema!), 'utf8'), `${skill.name}/${skill.schema}`);
  model.core = isCoreSkill(skill.name);
  return model;
}

const withSchema = SKILLS.filter((skill) => skill.schema);

/** Schema prefix → the file its skill declares. */
const pathOfPrefix = new Map(withSchema.map((skill) => [readModel(skill).prefix, path.join(SKILLS_DIR, skill.name, skill.schema!)]));

export function schemaPath(prefix: string): string {
  const found = pathOfPrefix.get(prefix);
  if (!found) throw new Error(`no skill declares a schema with prefix ${prefix}`);
  return found;
}

export function schemaSource(prefix: string): string {
  return readFileSync(schemaPath(prefix), 'utf8');
}

export const SCHEMA_MODELS: SchemaModel[] = sortSchemas(withSchema.map(readModel));

export const SCHEMAS: SchemaInfo[] = buildManifest(SCHEMA_MODELS);

/** A fresh parse of every schema; moddle mutates the models it is handed. */
export function loadSchemaModels(): SchemaModel[] {
  return sortSchemas(withSchema.map(readModel));
}

/** `models` as moddle packages, keyed by prefix: what `loader.ts loadSchemas` hands a `BpmnModdle`. */
export function schemaPackages(models: SchemaModel[]): Record<string, any> {
  return Object.fromEntries(models.map((model) => [model.prefix, toModdlePackages(model, models)]));
}
