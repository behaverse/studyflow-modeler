import type { CommandContext } from '../types';
import { runUpdateProperty } from './updateProperty';

export type InspectorUpdatePropertyCommand = {
  type: 'inspector-update-property';
  element: any;
  propertyName: string;
  value: any;
};

export function runInspectorUpdateProperty(
  context: CommandContext,
  command: InspectorUpdatePropertyCommand,
): void {
  runUpdateProperty(context, {
    type: 'update-property',
    element: command.element,
    propertyName: command.propertyName,
    value: command.value,
  });
}
