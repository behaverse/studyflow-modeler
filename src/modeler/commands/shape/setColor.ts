export type SetColorCommand = {
  type: 'set-color';
  elements: any[];
  color: { fill?: string; stroke?: string };
};

export function runSetColor(modeler: any, command: SetColorCommand): void {
  modeler.get('modeling').setColor(command.elements, command.color);
}
