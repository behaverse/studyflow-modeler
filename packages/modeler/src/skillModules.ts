import type { ComponentType } from 'react';
import { getCatalog, hasCatalog } from '@core/notation';
import { SCHEMA_MODELS, SKILLS, skillOfSchema } from '@core/notation/loader';
import type { SkillManifest } from '@core/notation/skill';
import type { Metamodel } from '@core/model/metamodel';
import type { ExportFormat } from '@modeler/diagram/formats';
import type { Editor } from '@modeler/editor/port';
import type { SaveDestination } from '@modeler/export/destinations';
import type { InspectorSection } from '@modeler/inspector/sections';
import type { SettingsSection } from '@modeler/settings/sections';

/** The context "Open" passes to a skill that converts a foreign file. */
export type OpenContext = {
  /** The file's name without its extension, for naming what it becomes. */
  name: string;
  /** The metamodel of the enabled schemas, to spell the study with. */
  metamodel: Metamodel;
  /** Tell the user what the conversion changed. */
  warn(message: string): void;
};

/** A foreign format a skill opens. Nothing writes one: "Open" converts it to BPMN XML on the way in. */
export type Opener = {
  label: string;
  extension: string;
  mimeType: string;
  /** The file as a `.studyflow.yaml`. */
  toStudyflow(text: string, context: OpenContext): string;
};

/**
 * A document a reporting guideline asks for, such as a participant flow or a schedule of visits. A skill draws it
 * from the diagram, and the Reporting Diagram view lists it and shows the drawing. The study stores none of it.
 */
export type ReportingDocument = {
  /** Unique among the skills: it names the file a download writes (`consort-2025-flow`). */
  id: string;
  /** The guideline that asks for it: `CONSORT 2025`. */
  guideline: string;
  /** The guideline's name for it: `Participant flow`. */
  label: string;
  /** One sentence on what it shows and what it reads off the diagram. */
  description: string;
  /** The picture, drawn from the study as it stands, or the sentence saying why this study has none. */
  draw(modeler: Pick<Editor, 'study'>): { svg: string } | { unavailable: string };
};

/**
 * A view of the study a skill shows in the canvas's place, switched in the nav bar beside Flow. It reads the study and
 * edits it through the commands the canvas uses.
 */
export type CanvasView = {
  /** Unique among the skills. */
  id: string;
  /** Its name on the nav bar's switch. */
  label: string;
  View: ComponentType;
};

/** The default export of a skill's `modeler.ts`: the projections the modeler writes, the foreign formats it opens,
 * the inspector sections it adds, its pages of Settings, the places "Save" can send a study besides this machine,
 * the reporting documents it draws, the examples the New dialog leads with, and the views it shows in the canvas's
 * place. */
export type ModelerModule = {
  exports?: ExportFormat[];
  opens?: Opener[];
  sections?: InspectorSection[];
  settings?: SettingsSection[];
  destinations?: SaveDestination[];
  documents?: ReportingDocument[];
  /** The skill's examples the New dialog shows before All templates is pressed, each by its file's name less
   * `.studyflow.yaml`: `cognitive_battery`. */
  featured?: string[];
  canvasViews?: CanvasView[];
};

// Loads every skill's `modeler.ts` eagerly, because the format lists are built once, at load. The module is
// always that file; `metadata.modeler` in `SKILL.md` says that the skill has one.
const modules = import.meta.glob('@skills/*/modeler.ts', { eager: true, import: 'default' }) as Record<string, ModelerModule>;

function loadSkillModules(): { skill: SkillManifest; module: ModelerModule }[] {
  const loaded: { skill: SkillManifest; module: ModelerModule }[] = [];
  for (const skill of SKILLS) {
    if (!skill.modelerModule) continue;
    const key = Object.keys(modules).find((path) => path.endsWith(`/${skill.name}/${skill.modelerModule}`));
    if (!key) {
      console.error(`[studyflow skill] ${skill.name}/SKILL.md names modeler ${skill.modelerModule}, but there is no such module`);
      continue;
    }
    loaded.push({ skill, module: modules[key] });
  }
  return loaded;
}

const BY_SKILL = loadSkillModules();
const LOADED = BY_SKILL.map(({ module }) => module);

export const SKILL_EXPORT_FORMATS: ExportFormat[] = LOADED.flatMap((module) => module.exports ?? []);
/** The examples the skills feature, each as `<skill>/<example>`. */
export const SKILL_FEATURED_EXAMPLES: ReadonlySet<string> = new Set(
  BY_SKILL.flatMap(({ skill, module }) => (module.featured ?? []).map((example) => `${skill.name}/${example}`)),
);
export const SKILL_OPENERS: Opener[] = LOADED.flatMap((module) => module.opens ?? []);
export const SKILL_INSPECTOR_SECTIONS: InspectorSection[] = LOADED.flatMap((module) => module.sections ?? []);
export const SKILL_SETTINGS_SECTIONS: SettingsSection[] = LOADED.flatMap((module) => module.settings ?? []);
export const SKILL_SAVE_DESTINATIONS: SaveDestination[] = LOADED.flatMap((module) => module.destinations ?? []);
export const SKILL_CANVAS_VIEWS: CanvasView[] = LOADED.flatMap((module) => module.canvasViews ?? []);

/**
 * The reporting documents of the skills in use, in the skills' order: a skill that ships a schema offers its own
 * while that schema is loaded (Settings, Extensions), so switching the skill off takes its documents away with its
 * elements; one that ships none always offers them.
 */
export function reportingDocuments(): ReportingDocument[] {
  const inUse = ({ skill }: { skill: SkillManifest }): boolean => {
    const prefixes = SCHEMA_MODELS.map((model) => model.prefix).filter((prefix) => skillOfSchema(prefix) === skill);
    return prefixes.length === 0 || (hasCatalog() && prefixes.some((prefix) => getCatalog().schemaFor(prefix) !== undefined));
  };
  return BY_SKILL.filter(inUse).flatMap(({ module }) => module.documents ?? []);
}
