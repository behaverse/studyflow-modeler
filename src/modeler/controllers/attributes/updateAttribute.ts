import { setAttribute } from '@/core/extensions';

export type UpdateAttributeCommand = {
  type: 'update-attribute';
  element: any;
  attributeName: string;
  value: any;
};

export function runUpdateAttribute(modeler: any, command: UpdateAttributeCommand): void {
  setAttribute(command.element, command.attributeName, command.value, modeler.get('modeling'));
}
