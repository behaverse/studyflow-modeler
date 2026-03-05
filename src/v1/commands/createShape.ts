import type { CommandContext } from './types';
import { resolveModeling } from './types';

export type CreateShapeCommand = {
  type: 'create-shape';
  shape: any;
  position: { x: number; y: number };
  parent: any;
};

export function runCreateShape(
  context: CommandContext,
  command: CreateShapeCommand,
): any {
  const modeling = resolveModeling(context);
  if (!modeling) {
    throw new Error("Command 'create-shape' requires modeling or modeler.");
  }

  modeling.createShape(command.shape, command.position, command.parent);
  return command.shape;
}
