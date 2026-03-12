import {
  createExtensionElement,
  getStudyflowDefaults,
  isExtendsType,
  setAppliedStudyflowType,
  setNamespacedAttr,
} from '../extensionElements';

export type CreateExampleShapeCommand = {
  type: 'create-example-shape';
  elementFactory: any;
  moddle: any;
  bpmnType: string;
  studyflowType?: string;
  overrideIconClass?: string;
  exampleProperties?: Record<string, any>;
  x?: number;
  y?: number;
  parent?: any;
};

export function runCreateExampleShape(
  command: CreateExampleShapeCommand,
): any {
  const {
    elementFactory,
    moddle,
    bpmnType,
    studyflowType,
    overrideIconClass,
    exampleProperties,
    x,
    y,
    parent,
  } = command;

  const defaults = studyflowType
    ? getStudyflowDefaults(studyflowType, moddle)
    : {};

  const properties: Record<string, any> = {
    ...defaults,
    ...(exampleProperties || {}),
  };
  const size = extractExampleDimensions(properties);

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

  if (isExtendsType(studyflowType, moddle)) {
    setAppliedStudyflowType(businessObject, studyflowType);

    for (const [key, value] of Object.entries(properties)) {
      businessObject.set(key, value);
    }

    if (overrideIconClass) {
      const schemaPrefix = studyflowType.split(':')[0];
      const iconAttrName = `${schemaPrefix}:icon`;
      setNamespacedAttr(businessObject, iconAttrName, overrideIconClass);
    }

    return shape;
  }

  const extension = createExtensionElement(
    businessObject,
    studyflowType,
    moddle,
    properties,
  );

  if (overrideIconClass) {
    const schemaPrefix = studyflowType.split(':')[0];
    const iconAttrName = `${schemaPrefix}:icon`;
    setNamespacedAttr(extension, iconAttrName, overrideIconClass);
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

function extractExampleDimensions(
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