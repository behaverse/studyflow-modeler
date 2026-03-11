import type { CommandContext } from './types';
import { resolveModeling } from './types';
import { isExtensionPrefix } from '../extensionElements';

function getExtensionElement(element: any): any {
  const bo = element?.businessObject ?? element;
  const values = bo?.extensionElements?.values;
  if (!values) return null;

  return values.find((ext: any) =>
    isExtensionPrefix(ext.$type?.split(':')?.[0])
  ) ?? null;
}

export type UpdateExtensionPropertyCommand = {
  type: 'update-extension-property';
  element: any;
  propertyName: string;
  value: any;
};

export function runUpdateExtensionProperty(
  context: CommandContext,
  command: UpdateExtensionPropertyCommand,
): void {
  const modeling = resolveModeling(context);
  if (!modeling) {
    throw new Error("Command 'update-extension-property' requires modeling or modeler.");
  }

  const ext = getExtensionElement(command.element);
  if (!ext) return;

  modeling.updateModdleProperties(command.element, ext, {
    [command.propertyName]: command.value,
  });
}
