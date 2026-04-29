import { runUpdateProperty } from './updateProperty';

export type InspectorUpdatePropertyCommand = {
  type: 'inspector-update-property';
  element: any;
  propertyName: string;
  value: any;
};

export function runInspectorUpdateProperty(
  modeler: any,
  command: InspectorUpdatePropertyCommand,
): void {
  runUpdateProperty(modeler, {
    type: 'update-property',
    element: command.element,
    propertyName: command.propertyName,
    value: command.value,
  });
}
