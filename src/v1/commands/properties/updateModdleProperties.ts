import type { CommandContext } from '../types';
import { resolveModeling } from '../types';

export type UpdateModdlePropertiesCommand = {
  type: 'update-moddle-properties';
  element: any;
  moddleElement: any;
  properties: Record<string, any>;
};

export function runUpdateModdleProperties(
  context: CommandContext,
  command: UpdateModdlePropertiesCommand,
): void {
  const modeling = resolveModeling(context);
  if (!modeling) {
    throw new Error("Command 'update-moddle-properties' requires modeling or modeler.");
  }

  modeling.updateModdleProperties(
    command.element,
    command.moddleElement,
    command.properties,
  );
}
