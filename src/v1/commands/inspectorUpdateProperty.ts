import type { CommandContext } from './types';

export type InspectorUpdatePropertyCommand = {
  type: 'inspector-update-property';
  element: any;
  propertyName: string;
  value: any;
  useExtension: boolean;
};

export function runInspectorUpdateProperty(
  context: CommandContext,
  command: InspectorUpdatePropertyCommand,
): void {
  if (!context.modeler) {
    throw new Error("Command 'inspector-update-property' requires a modeler instance.");
  }

  if (command.useExtension) {
    const modeling = context.modeler.get('modeling');
    const bo = command.element?.businessObject ?? command.element;
    const values = bo?.extensionElements?.values ?? [];
    const ext = values.find((v: any) => typeof v?.$type === 'string' && v.$type.includes(':'));
    if (!ext) return;

    modeling.updateModdleProperties(command.element, ext, {
      [command.propertyName]: command.value,
    });
    return;
  }

  const targetElement = command.propertyName === 'bpmn:id'
    ? context.modeler.get('elementRegistry').get(command.element.id)
    : command.element;

  if (!targetElement) return;

  context.modeler.get('modeling').updateProperties(targetElement, {
    [command.propertyName === 'bpmn:id' ? 'id' : command.propertyName]: command.value,
  });
}
