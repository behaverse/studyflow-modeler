import { setProperty } from '../../extensions';

export type UpdatePropertyCommand = {
  type: 'update-property';
  element: any;
  propertyName: string;
  value: any;
};

export function runUpdateProperty(
  modeler: any,
  command: UpdatePropertyCommand,
): void {
  if (!modeler) {
    throw new Error("Command 'update-property' requires a modeler instance.");
  }

  const modeling = modeler.get('modeling');
  setProperty(command.element, command.propertyName, command.value, modeling);
}
