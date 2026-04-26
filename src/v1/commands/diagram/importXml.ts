export type ImportXmlCommand = {
  type: 'import-xml';
  xml: string;
};

export async function runImportXml(
  modeler: any,
  command: ImportXmlCommand,
): Promise<any> {
  if (!modeler) {
    throw new Error("Command 'import-xml' requires a modeler instance.");
  }

  return modeler.importXML(command.xml);
}
