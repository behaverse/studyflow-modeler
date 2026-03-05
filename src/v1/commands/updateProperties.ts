import type { CommandContext } from './types';
import { resolveModeling } from './types';

export type UpdatePropertiesCommand = {
  type: 'update-properties';
  element: any;
  properties: Record<string, any>;
};

export function runUpdateProperties(
  context: CommandContext,
  command: UpdatePropertiesCommand,
): void {
  const modeling = resolveModeling(context);
  if (!modeling) {
    throw new Error("Command 'update-properties' requires modeling or modeler.");
  }

  modeling.updateProperties(command.element, command.properties);
}
