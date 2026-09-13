import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '@core/notation';
import { fromLinkml, parseLinkml } from '@core/notation/linkml';
import { toModdlePackages, type SchemaModel } from '@core/notation/moddlePackage';
import { buildManifest, sortSchemas, type SchemaInfo } from '@core/notation/manifest';
import { parseSkillManifest, type SkillManifest } from '@core/notation/skill';

/**
 * The Node counterpart of `packages/core/src/notation/loader.ts`, which reads the same files through Vite's bundle.
 * Importing it installs the shipped schemas' catalog, which the core readers consult, as the app does at load.
 */

const SKILLS_DIR = path.join(process.cwd(), 'skills');

/** Every `skills/<name>/SKILL.md`, parsed. */
const SKILLS: SkillManifest[] = readdirSync(SKILLS_DIR)
  .filter((name) => existsSync(path.join(SKILLS_DIR, name, 'SKILL.md')))
  .map((name) => parseSkillManifest(readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8'), name))
  .sort((a, b) => a.name.localeCompare(b.name));

const withSchema = SKILLS.filter((skill) => skill.schema);
const schemaFiles = withSchema.map((skill) => path.join(SKILLS_DIR, skill.name, skill.schema!));

/** Every schema, converted together as `loader.ts` does. */
function readModels(): SchemaModel[] {
  return fromLinkml(schemaFiles.map((file) => parseLinkml(readFileSync(file, 'utf8'), file)));
}

export const SCHEMAS: SchemaInfo[] = buildManifest(readModels());

/** A fresh parse of every schema, in load order, for a caller to change as it likes. */
export function loadSchemaModels(): SchemaModel[] {
  return sortSchemas(readModels());
}

/** The `lab` fixture schema, the one place a `connectsTo` allow-list is declared. */
export function connectsToFixture(): SchemaModel {
  const file = path.join(process.cwd(), 'tests/fixtures/connects-to.linkml.yaml');
  return fromLinkml([parseLinkml(readFileSync(file, 'utf8'), 'tests/fixtures/connects-to.linkml.yaml')])[0];
}

/** `models` as moddle packages, keyed by prefix: what `loader.ts loadSchemas` hands a `BpmnModdle`. */
export function schemaPackages(models: SchemaModel[]): Record<string, any> {
  return Object.fromEntries(models.map((model) => [model.prefix, toModdlePackages(model, models)]));
}

setCatalog(buildCatalog(loadSchemaModels()));

const PACKAGES = schemaPackages(loadSchemaModels());

/** The shipped schemas as moddle packages, a copy per call: moddle rewrites the packages it registers. */
export function freshPackages(): Record<string, any> {
  return structuredClone(PACKAGES);
}

/** A moddle over the shipped schemas that nothing else has parsed with. */
export function freshModdle(): any {
  return new BpmnModdle(freshPackages()) as any;
}
