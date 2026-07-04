/**
 * Interoperability bridge: import a jsPsych timeline as a `.studyflow` file.
 *
 * ```ts
 * import { jsPsychToStudyflow } from '@/modeler/models/import';
 * const { studyflow, study } = await jsPsychToStudyflow(timeline, packages, { name: 'My study' });
 * ```
 *
 * `studyflow` is the `.studyflow` YAML serialization (the modern format).
 * `packages` are the moddle schema packages (`toModdlePackages` output). At
 * runtime, `loadSchemas()` returns them; tests build them directly.
 */

export type {
  JsPsychNode,
  JsPsychTimelineInput,
  JsPsychImportOptions,
  ImportedTask,
  ImportedStudy,
} from '@/modeler/models/import/jspsych';
export { importJsPsychTimeline, parseTimeline } from '@/modeler/models/import/jspsych';
export { buildStudyflowYaml, buildStudyflowXml } from '@/modeler/models/import/studyflowDocument';

import { importJsPsychTimeline, type JsPsychImportOptions, type JsPsychTimelineInput, type ImportedStudy } from '@/modeler/models/import/jspsych';
import { buildStudyflowYaml } from '@/modeler/models/import/studyflowDocument';

/** Import a jsPsych timeline and serialize it to a `.studyflow` YAML string. */
export async function jsPsychToStudyflow(
  input: JsPsychTimelineInput,
  packages: Record<string, any>,
  options: JsPsychImportOptions = {},
): Promise<{ studyflow: string; study: ImportedStudy }> {
  const study = importJsPsychTimeline(input, options);
  const studyflow = await buildStudyflowYaml(study, packages);
  return { studyflow, study };
}
