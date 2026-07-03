import { normalizeStudyflowXml } from '@/lib/core/studyflowYaml';
import { fromWireXml } from '@/lib/core/choreographyRoot';

export type ImportXmlCommand = {
  type: 'import-xml';
  xml: string;
};

export async function runImportXml(modeler: any, command: ImportXmlCommand): Promise<any> {
  // Choreography-root files are converted to the process form the canvas edits.
  const xml = await fromWireXml(normalizeStudyflowXml(command.xml), modeler.get('moddle'));
  return modeler.importXML(xml);
}
