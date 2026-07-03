/**
 * Interoperability bridge: import a jsPsych timeline as a `.studyflow` file.
 *
 * ```ts
 * import { jsPsychToStudyflow } from '@/lib/core/import';
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
} from './jspsych';
export { importJsPsychTimeline, parseTimeline } from './jspsych';
export { buildStudyflowYaml, buildStudyflowXml } from './studyflowDocument';

import { importJsPsychTimeline, type JsPsychImportOptions, type JsPsychTimelineInput, type ImportedStudy } from './jspsych';
import { buildStudyflowYaml } from './studyflowDocument';

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
