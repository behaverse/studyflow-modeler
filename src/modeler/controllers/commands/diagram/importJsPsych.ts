import { buildStudyflowXml, importJsPsychTimeline } from '@/modeler/models/import';
import { filenameStem } from '@/modeler/models/diagramFile';
import { loadSchemas } from '@/core/schema/loader';
import { getSettings } from '@/modeler/infra/settings/store';
import { runOpenDiagram } from '@/modeler/controllers/commands/diagram/openDiagram';

export type ImportJsPsychCommand = {
  type: 'import-jspsych';
  filename: string;
  content: string;
};

/**
 * Convert a jsPsych timeline (JSON) through the import bridge and open the
 * result. A separate command from `open-diagram` on purpose: `.json` says
 * nothing about its content, so the conversion only runs when the user
 * explicitly asks for a jsPsych import.
 */
export async function runImportJsPsych(modeler: any, command: ImportJsPsychCommand): Promise<any> {
  const name = filenameStem(command.filename);
  const study = importJsPsychTimeline(command.content, { name });
  for (const warning of study.warnings) console.warn(`jsPsych import: ${warning}`);

  // `cognitive` is a core schema, so the packages always cover the imported elements.
  const packages = await loadSchemas(getSettings().enabledSchemas);
  const xml = await buildStudyflowXml(study, packages);
  return runOpenDiagram(modeler, { type: 'open-diagram', filename: command.filename, content: xml });
}
