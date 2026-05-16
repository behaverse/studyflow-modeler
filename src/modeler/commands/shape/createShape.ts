export type CreateShapeCommand = {
  type: 'create-shape';
  shape: any;
  position: { x: number; y: number };
  parent: any;
};

export function runCreateShape(modeler: any, command: CreateShapeCommand): any {
  modeler.get('modeling').createShape(command.shape, command.position, command.parent);
  return command.shape;
}
