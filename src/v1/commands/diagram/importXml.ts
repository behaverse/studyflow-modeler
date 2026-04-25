import type { CommandContext } from '../types';

export type ImportXmlCommand = {
  type: 'import-xml';
  xml: string;
};

export async function runImportXml(
  context: CommandContext,
  command: ImportXmlCommand,
): Promise<any> {
  if (!context.modeler) {
    throw new Error("Command 'import-xml' requires a modeler instance.");
  }

  return context.modeler.importXML(command.xml);
}
