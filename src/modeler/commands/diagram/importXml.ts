import { normalizeStudyflowXml } from '@/lib/core/codec';

export type ImportXmlCommand = {
  type: 'import-xml';
  xml: string;
};

export async function runImportXml(modeler: any, command: ImportXmlCommand): Promise<any> {
  return modeler.importXML(normalizeStudyflowXml(command.xml));
}
