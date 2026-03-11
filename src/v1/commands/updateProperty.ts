import type { CommandContext } from './types';
import { resolveModeling } from './types';
import { isExtensionPrefix } from '../extensionElements';
import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';

function getExtensionElement(element: any): any {
  const bo = element?.businessObject ?? element;
  const values = bo?.extensionElements?.values;
  if (!values) return null;

  return values.find((ext: any) =>
    isExtensionPrefix(ext.$type?.split(':')?.[0])
  ) ?? null;
}

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

  const ext = getExtensionElement(command.element) ?? getBusinessObject(command.element);
  if (!ext) return;

  modeling.updateModdleProperties(command.element, ext, {
    [command.propertyName]: command.value,
  });
}
