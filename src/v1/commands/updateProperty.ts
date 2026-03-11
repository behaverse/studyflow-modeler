import type { CommandContext } from './types';
import { resolveModeling } from './types';
import { getExtensionElementOrBusinessObject } from '../extensionElements';

export type UpdatePropertyCommand = {
  type: 'update-property';
  element: any;
  propertyName: string;
  value: any;
};

export function runUpdateProperty(
  context: CommandContext,
  command: UpdatePropertyCommand,
): void {
  const modeling = resolveModeling(context);
  if (!modeling) {
    throw new Error("Command 'update-property' requires modeling or modeler.");
  }

  const ext = getExtensionElementOrBusinessObject(command.element);
  if (!ext) return;

  modeling.updateModdleProperties(command.element, ext, {
    [command.propertyName]: command.value,
  });
}
