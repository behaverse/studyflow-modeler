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

  const bo = shape.businessObject;
  const bpmnName = attributes['bpmn:name'];
  if (bpmnName !== undefined) {
    delete attributes['bpmn:name'];
    bo.set('name', bpmnName);
  }

  // Native loop child (BPMN's own construct; also what makes bpmn-js draw the
  // loop / multi-instance marker). Templates author it as a nested map.
  const loop = attributes['loopCharacteristics'];
  if (loop && typeof loop === 'object') {
    delete attributes['loopCharacteristics'];
    const { type: loopType = 'bpmn:StandardLoopCharacteristics', ...fields } = loop as Record<string, any>;
    const lc = moddle.create(loopType, fields);
    lc.$parent = bo;
    bo.set('loopCharacteristics', lc);
  }

  // Native event-definition children (timer, message, conditional, ...; also
  // what makes bpmn-js draw the trigger marker on an event). Templates author
  // them as a nested list, like `loopCharacteristics`.
  const eventDefinitions = attributes['eventDefinitions'];
  if (Array.isArray(eventDefinitions)) {
    delete attributes['eventDefinitions'];
    bo.set('eventDefinitions', eventDefinitions.map((definition: Record<string, any>) => {
      const { type: definitionType, ...fields } = definition;
      const eventDefinition = moddle.create(definitionType, fields);
      eventDefinition.$parent = bo;
      return eventDefinition;
    }));
  }

  if (!extensionType) {
    // Plain BPMN root: no extension to stamp; attributes (trait fields like
    // `until`, native ones like `implementation`) write straight through.
    const handle = StudyflowElement.fromBusinessObject(bo);
    for (const [name, value] of Object.entries(attributes)) handle.write(name, value);
    return shape;
  }

  const ext = StudyflowElement.fromBusinessObject(bo).ensureExtension(extensionType, moddle, attributes);

  if (overrideIconClass) {
    const extPrefix = toPrefix(extensionType);
    if (extPrefix) setRawAttribute(ext, `${extPrefix}:icon`, overrideIconClass);
  }

  return shape;
}
