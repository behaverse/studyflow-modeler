export type UpdateModdlePropertiesCommand = {
  type: 'update-moddle-properties';
  element: any;
  moddleElement: any;
  properties: Record<string, any>;
};

export function runUpdateModdleProperties(
  modeler: any,
  command: UpdateModdlePropertiesCommand,
): void {
  if (!modeler) {
    throw new Error("Command 'update-moddle-properties' requires a modeler instance.");
  }

  const modeling = modeler.get('modeling');
  modeling.updateModdleProperties(
    command.element,
    command.moddleElement,
    command.properties,
  );
}
