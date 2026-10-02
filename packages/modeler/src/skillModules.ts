import { SKILLS } from '@core/notation/loader';
import type { Metamodel } from '@core/model/metamodel';
import type { ExportFormat } from '@modeler/diagram/formats';
import type { SaveDestination } from '@modeler/export/destinations';
import type { InspectorSection } from '@modeler/inspector/sections';
import type { SettingsSection } from '@modeler/settings/sections';

/** What "Open" hands a skill converting a foreign file. */
export type OpenContext = {
  /** The file's name without its extension, for naming what it becomes. */
  name: string;
  /** The metamodel of the enabled schemas, to spell the study with. */
  metamodel: Metamodel;
  /** Tell the user what the conversion changed. */
  warn(message: string): void;
};

/** A foreign format a skill opens: not an export format (nothing writes one), but "Open" converts it to BPMN XML on the way in. */
export type Opener = {
  label: string;
  extension: string;
  mimeType: string;
  /** The file as a `.studyflow.yaml`. */
  toStudyflow(text: string, context: OpenContext): string;
};

/** What a skill's `modeler.ts` exports by default: the projections the modeler writes, the foreign formats it opens,
 * the inspector sections it adds, its pages of Settings, and the places "Save" can send a study besides this machine. */
export type ModelerModule = {
  exports?: ExportFormat[];
  opens?: Opener[];
  sections?: InspectorSection[];
  settings?: SettingsSection[];
  destinations?: SaveDestination[];
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
export const SKILL_INSPECTOR_SECTIONS: InspectorSection[] = LOADED.flatMap((module) => module.sections ?? []);
export const SKILL_SETTINGS_SECTIONS: SettingsSection[] = LOADED.flatMap((module) => module.settings ?? []);
export const SKILL_SAVE_DESTINATIONS: SaveDestination[] = LOADED.flatMap((module) => module.destinations ?? []);
