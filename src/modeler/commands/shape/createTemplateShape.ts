import { createExtensionElement, getDefaults, setAttr } from '../../extensions';
import { toPrefix } from '../../utils/naming';

export type CreateTemplateShapeCommand = {
  type: 'create-template-shape';
  elementFactory: any;
  moddle: any;
  bpmnType: string;
  studyflowType?: string;
  overrideIconClass?: string;
  templateProperties?: Record<string, any>;
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
    studyflowType,
    overrideIconClass,
    templateProperties,
    x,
    y,
    parent,
  } = command;

  const defaults = studyflowType
    ? getDefaults(studyflowType, moddle)
    : {};

  const properties: Record<string, any> = {
    ...defaults,
    ...(templateProperties || {}),
  };
  const size = extractTemplateDimensions(properties);

  const shape = elementFactory.create('shape', {
    type: bpmnType,
    ...size,
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(parent ? { parent } : {}),
  });

  if (!studyflowType) {
    return shape;
  }

  const businessObject = shape.businessObject;
  const bpmnName = properties['bpmn:name'];
  if (bpmnName !== undefined) {
    delete properties['bpmn:name'];
    businessObject.set('name', bpmnName);
  }

  const extension = createExtensionElement(
    businessObject,
    studyflowType,
    moddle,
    properties,
  );

  if (overrideIconClass) {
    const schemaPrefix = toPrefix(studyflowType);
    if (schemaPrefix) {
      setAttr(extension, `${schemaPrefix}:icon`, overrideIconClass);
    }
  }

  return shape;
}

function toFiniteNumber(value: any): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function extractTemplateDimensions(
  properties: Record<string, any>,
): { width?: number; height?: number } {
  const width = toFiniteNumber(properties['bpmn:width'] ?? properties.width);
  const height = toFiniteNumber(properties['bpmn:height'] ?? properties.height);

  delete properties['bpmn:width'];
  delete properties['bpmn:height'];
  delete properties.width;
  delete properties.height;

  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}
