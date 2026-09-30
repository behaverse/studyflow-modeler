/**
 * Skills installed beside the CLI rather than shipped in it: `studyflow skill add <git-url | folder>` puts one in
 * `$STUDYFLOW_HOME/skills/<name>` (`~/.studyflow/skills`), where `validate`, `convert`, `mcp` and `run` find it: its
 * schema joins the shipped ones, and the local runtime finds its runner there as it finds a shipped skill's.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { fromModdleYaml } from '@core/notation/moddlePackage';
import { parseSkillManifest, type SkillManifest } from '@core/notation/skill';
import type { SchemaModel } from '@core/notation/moddlePackage';

export function skillsHome(): string {
  return path.join(process.env.STUDYFLOW_HOME || path.join(homedir(), '.studyflow'), 'skills');
}

export type InstalledSkill = { folder: string; manifest: SkillManifest; schema?: SchemaModel };

/** Every skill installed in the skills home, each read from its `SKILL.md` and its schema. */
export function installedSkills(): InstalledSkill[] {
  const home = skillsHome();
  if (!existsSync(home)) return [];
  return readdirSync(home, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(home, entry.name, 'SKILL.md')))
    .map((entry) => readSkill(path.join(home, entry.name)))
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

function readSkill(folder: string): InstalledSkill {
  const manifest = parseSkillManifest(readFileSync(path.join(folder, 'SKILL.md'), 'utf8'), path.basename(folder));
  const schema = manifest.schema
    ? fromModdleYaml(readFileSync(path.join(folder, manifest.schema), 'utf8'), `${manifest.name}/${manifest.schema}`)
    : undefined;
  return { folder, manifest, schema };
}

/** Install the skill at `source`, a folder or a git URL, under the name its `SKILL.md` gives; a skill of that name is replaced. */
export function addSkill(source: string): InstalledSkill {
  const local = existsSync(source);
  const staging = local ? path.resolve(source) : path.join(mkdtempSync(path.join(tmpdir(), 'studyflow-skill-')), 'skill');
  if (!local) execFileSync('git', ['clone', '--depth', '1', source, staging], { stdio: 'pipe' });
  const manifest = parseSkillManifest(readFileSync(path.join(staging, 'SKILL.md'), 'utf8'));
  const target = path.join(skillsHome(), manifest.name);
  rmSync(target, { recursive: true, force: true });
  cpSync(staging, target, { recursive: true, filter: (file) => path.basename(file) !== '.git' });
  if (!local) rmSync(path.dirname(staging), { recursive: true, force: true });
  return readSkill(target);
}

export function removeSkill(name: string): boolean {
  const target = path.join(skillsHome(), name);
  if (!existsSync(target)) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}

/** Each installed skill's schema as its text, for the desktop app, which loads it beside the shipped ones. */
export function installedSchemas(): { skill: string; description: string; schema: string; source: string }[] {
  return installedSkills().flatMap(({ folder, manifest }) => (manifest.schema
    ? [{ skill: manifest.name, description: manifest.description, schema: `${manifest.name}/${manifest.schema}`, source: readFileSync(path.join(folder, manifest.schema), 'utf8') }]
    : []));
}
