import { newShape } from '@modeler/palette/newShape';
import type { Editor } from '@modeler/editor/port';

export type PaletteStartCreateTemplateCommand = {
  type: 'PaletteStartCreateTemplate';
  templateId: string;
  event: MouseEvent | any;
};

/** Drag a template from the palette: it drops as its shape, its flow laid out inside. */
export function runPaletteStartCreateTemplate(modeler: Editor, command: PaletteStartCreateTemplateCommand): boolean {
  return modeler.canvas.startCreate(command.event, { template: command.templateId });
}


export type PaletteStartCreateCommand = {
  type: 'PaletteStartCreate';
  bpmnType: string;
  event: MouseEvent | any;
  attributes?: Record<string, unknown>;
  extensionType?: string;
};

export function runPaletteStartCreate(modeler: Editor, command: PaletteStartCreateCommand): boolean {
  return modeler.canvas.startCreate(command.event, newShape(command.bpmnType, command.extensionType, command.attributes));
}
