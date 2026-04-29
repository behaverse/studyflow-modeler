export type CreateShapeCommand = {
  type: 'create-shape';
  shape: any;
  position: { x: number; y: number };
  parent: any;
};

export function runCreateShape(
  modeler: any,
  command: CreateShapeCommand,
): any {
  if (!modeler) {
    throw new Error("Command 'create-shape' requires a modeler instance.");
  }

  const modeling = modeler.get('modeling');
  modeling.createShape(command.shape, command.position, command.parent);
  return command.shape;
}
