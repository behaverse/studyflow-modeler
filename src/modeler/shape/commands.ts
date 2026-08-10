import type { Modeler } from '@/modeler/bpmn/types';

export type SetColorCommand = {
  type: 'SetColor';
  elements: any[];
  color: { fill?: string; stroke?: string };
};

export function runSetColor(modeler: Modeler, command: SetColorCommand): void {
  modeler.get('modeling').setColor(command.elements, command.color);
}
