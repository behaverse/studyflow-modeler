import { getDefaults, setRawAttribute, StudyflowElement } from '@/core/extensions';
import { toPrefix } from '@/core/naming';
import { takeSize } from '@/modeler/models/shape/template';

type CreateTemplateShapeCommand = {
  type: 'create-template-shape';
  elementFactory: any;
  moddle: any;
  bpmnType: string;
  extensionType?: string;
  overrideIconClass?: string;
  templateAttributes?: Record<string, any>;
  x?: number;
  y?: number;
  parent?: any;
};

export function runCreateTemplateShape(
  command: CreateTemplateShapeCommand,
): any {
  const {
    elementFactory,
    moddle,
    bpmnType,
    extensionType,
    overrideIconClass,
    templateAttributes,
    x,
    y,
    parent,
  } = command;

  const defaults = extensionType ? getDefaults(extensionType) : {};
  const attributes: Record<string, any> = { ...defaults, ...(templateAttributes || {}) };
  const size = takeSize(attributes);

  const shape = elementFactory.create('shape', {
    type: bpmnType,
    ...size,
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(parent ? { parent } : {}),
  });

  if (!extensionType) return shape;

  const bo = shape.businessObject;
  const bpmnName = attributes['bpmn:name'];
  if (bpmnName !== undefined) {
    delete attributes['bpmn:name'];
    bo.set('name', bpmnName);
  }

  const ext = StudyflowElement.fromBusinessObject(bo).ensureExtension(extensionType, moddle, attributes);

  if (overrideIconClass) {
    const extPrefix = toPrefix(extensionType);
    if (extPrefix) setRawAttribute(ext, `${extPrefix}:icon`, overrideIconClass);
  }

  return shape;
}
