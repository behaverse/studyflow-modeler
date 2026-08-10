export type {
  JsPsychNode,
  JsPsychTimelineInput,
  JsPsychImportOptions,
  ImportedStudy,
} from '@/modeler/import/jspsych';
export { importJsPsychTimeline, parseTimeline } from '@/modeler/import/jspsych';
export { buildStudyflowXml } from '@/modeler/import/studyflowDocument';

import { importJsPsychTimeline, type JsPsychImportOptions, type JsPsychTimelineInput, type ImportedStudy } from '@/modeler/import/jspsych';
import { buildStudyflowYaml } from '@/modeler/import/studyflowDocument';

export async function jsPsychToStudyflow(
  input: JsPsychTimelineInput,
  packages: Record<string, any>,
  options: JsPsychImportOptions = {},
): Promise<{ studyflow: string; study: ImportedStudy }> {
  const study = importJsPsychTimeline(input, options);
  const studyflow = await buildStudyflowYaml(study, packages);
  return { studyflow, study };
}
