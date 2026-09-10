import { SKILLS } from '@core/notation/loader';
import type { ExportFormat } from '@modeler/export/formats';

/** What "Open" hands a skill converting a foreign file. */
export type OpenContext = {
  /** The file's name without its extension, for naming what it becomes. */
  name: string;
  /** The enabled schemas as moddle packages, to build the document with. */
  packages: Record<string, any>;
  /** Tell the user what the conversion changed. */
  warn(message: string): void;
};

/** A foreign format a skill opens: not an export format (nothing writes one), but "Open" converts it to BPMN XML on the way in. */
export type Opener = {
  label: string;
  extension: string;
  mimeType: string;
  toXml(text: string, context: OpenContext): Promise<string>;
};

/** What a skill's `modeler.ts` exports by default: the projections the modeler writes, the foreign formats it opens. */
export type ModelerModule = {
  exports?: ExportFormat[];
  opens?: Opener[];
};

// Every skill's `modeler.ts`, eagerly: the format lists are built once, at load, from what is here. The module is
// always that file; `metadata.modeler` in `SKILL.md` says the skill has one.
const modules = import.meta.glob('@skills/*/modeler.ts', { eager: true, import: 'default' }) as Record<string, ModelerModule>;

function loadSkillModules(): ModelerModule[] {
  const loaded: ModelerModule[] = [];
  for (const skill of SKILLS) {
    if (!skill.modelerModule) continue;
    const key = Object.keys(modules).find((path) => path.endsWith(`/${skill.name}/${skill.modelerModule}`));
    if (!key) {
      console.error(`[studyflow skill] ${skill.name}/SKILL.md names modeler ${skill.modelerModule}, but there is no such module`);
      continue;
    }
    loaded.push(modules[key]);
  }
  return loaded;
}

const LOADED = loadSkillModules();

export const SKILL_EXPORT_FORMATS: ExportFormat[] = LOADED.flatMap((module) => module.exports ?? []);
export const SKILL_OPENERS: Opener[] = LOADED.flatMap((module) => module.opens ?? []);
