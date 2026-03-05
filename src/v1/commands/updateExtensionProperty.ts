import type { CommandContext } from './types';
import { resolveModeling } from './types';

const CORE_PREFIXES = new Set([
  'bpmn',
  'bpmndi',
  'dc',
  'di',
  'xsi',
  'xml',
  'camunda',
  'zeebe',
  'flowable',
]);

function isCustomSchemaPrefix(prefix: string | undefined): boolean {
  return Boolean(prefix && !CORE_PREFIXES.has(prefix));
}

function getStudyflowExtension(element: any): any {
  const bo = element?.businessObject ?? element;
  const values = bo?.extensionElements?.values;
  if (!values) return null;

  return values.find((ext: any) =>
    isCustomSchemaPrefix(ext.$type?.split(':')?.[0])
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

  const ext = getStudyflowExtension(command.element);
  if (!ext) return;

  modeling.updateModdleProperties(command.element, ext, {
    [command.propertyName]: command.value,
  });
}
