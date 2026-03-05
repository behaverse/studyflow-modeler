import type { CommandContext } from './types';
import { createStudyflowExtension, getStudyflowDefaults, isExtendsType } from '../extensionElements';

export type PaletteStartCreateCommand = {
  type: 'palette-start-create';
  bpmnType: string;
  event: MouseEvent | any;
  attrs?: Record<string, unknown>;
  studyflowType?: string;
};

export function runPaletteStartCreate(
  context: CommandContext,
  command: PaletteStartCreateCommand,
): any {
  if (!context.modeler) {
    throw new Error("Command 'palette-start-create' requires a modeler instance.");
  }

  const bpmnFactory = context.modeler.get('bpmnFactory');
  const elementFactory = context.modeler.get('elementFactory');
  const create = context.modeler.get('create');
  const moddle = bpmnFactory._model;

  const attrs = command.attrs ?? {};
  const prefix = command.studyflowType
    ? command.studyflowType.split(':')[1]
    : (command.bpmnType.includes(':') ? command.bpmnType.split(':')[1] : command.bpmnType);
  const generatedId = moddle.ids.nextPrefixed(`${prefix}_`);

  let extendedDefaults: Record<string, any> = {};
  if (command.studyflowType && isExtendsType(command.studyflowType, moddle)) {
    extendedDefaults = getStudyflowDefaults(command.studyflowType, moddle);
  }

  const businessObject = bpmnFactory.create(command.bpmnType, {
    ...extendedDefaults,
    ...attrs,
    id: generatedId,
  });

  businessObject.id = businessObject.id || generatedId;

  if (command.studyflowType && !isExtendsType(command.studyflowType, moddle)) {
    const defaults = getStudyflowDefaults(command.studyflowType, moddle);
    createStudyflowExtension(businessObject, command.studyflowType, moddle, defaults);
  }

  const shape = elementFactory.createShape({
    type: command.bpmnType,
    businessObject,
  });

  create.start(command.event, shape);
  return shape;
}
