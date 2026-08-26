import { getEditorPort } from '@modeler/editor/bpmnAdapter';
import type { Modeler } from '@modeler/bpmn/types';

export type SetColorCommand = {
  type: 'SetColor';
  elements: any[];
  color: { fill?: string; stroke?: string };
};

export function runSetColor(modeler: Modeler, command: SetColorCommand): void {
  getEditorPort(modeler).mutate.setColor(command.elements, command.color);
}
