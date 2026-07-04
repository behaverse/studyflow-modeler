import { buildBusinessObject } from '@/modeler/models/shape/buildBusinessObject';
import { primeHoverFromEvent } from '@/modeler/controllers/commands/palette/primeHover';

export type PaletteStartCreateCommand = {
  type: 'palette-start-create';
  bpmnType: string;
  event: MouseEvent | any;
  attributes?: Record<string, unknown>;
  extensionType?: string;
};

export function runPaletteStartCreate(modeler: any, command: PaletteStartCreateCommand): any {
  const bo = buildBusinessObject(modeler, command.bpmnType, {
    attributes: command.attributes,
    extensionType: command.extensionType,
  });
  const shape = modeler.get('elementFactory').createShape({
    type: command.bpmnType,
    businessObject: bo,
  });

  modeler.get('create').start(command.event, shape);
  primeHoverFromEvent(modeler, command.event);

  return shape;
}
