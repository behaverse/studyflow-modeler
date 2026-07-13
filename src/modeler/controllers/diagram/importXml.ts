import { normalizeStudyflowXml } from '@/core/codec';
import { fromWireXml } from '@/core/codec/choreography';
import { ensureDiagramLayout } from '@/modeler/models/autoLayout';

export type ImportXmlCommand = {
  type: 'import-xml';
  xml: string;
};

export async function runImportXml(modeler: any, command: ImportXmlCommand): Promise<any> {
  // Choreography-root files are converted to the process form the canvas edits.
  const wireXml = await fromWireXml(normalizeStudyflowXml(command.xml), modeler.get('moddle'));
  // Hand-written files carry no geometry; synthesize a layout so they render.
  const xml = await ensureDiagramLayout(wireXml);
  return modeler.importXML(xml);
}
