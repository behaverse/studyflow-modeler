import { buildBusinessObject, buildShape } from '../shape';

export type PaletteStartCreateCommand = {
  type: 'palette-start-create';
  bpmnType: string;
  event: MouseEvent | any;
  attrs?: Record<string, unknown>;
  studyflowType?: string;
};

export function runPaletteStartCreate(
  modeler: any,
  command: PaletteStartCreateCommand,
): any {
  if (!modeler) {
    throw new Error("Command 'palette-start-create' requires a modeler instance.");
  }

  const businessObject = buildBusinessObject(modeler, command.bpmnType, {
    attrs: command.attrs,
    studyflowType: command.studyflowType,
  });

  const shape = buildShape(
    modeler.get('elementFactory'),
    command.bpmnType,
    businessObject,
  );

  modeler.get('create').start(command.event, shape);
  return shape;
}
