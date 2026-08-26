import { getEditorPort } from '@modeler/editor/registry';
import type { EditorHandle } from '@modeler/editor/registry';

export type SetColorCommand = {
  type: 'SetColor';
  elements: any[];
  color: { fill?: string; stroke?: string };
};

export function runSetColor(modeler: EditorHandle, command: SetColorCommand): void {
  getEditorPort(modeler).mutate.setColor(command.elements, command.color);
}
