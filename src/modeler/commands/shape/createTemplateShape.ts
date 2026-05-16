import { createExtensionElement, getDefaults, setRawAttribute } from '@/lib/core/extensions';
import { toPrefix } from '@/lib/core/utils/naming';

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

  const defaults = extensionType ? getDefaults(extensionType, moddle) : {};
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

  const ext = createExtensionElement(bo, extensionType, moddle, attributes);

  if (overrideIconClass) {
    const extPrefix = toPrefix(extensionType);
    if (extPrefix) setRawAttribute(ext, `${extPrefix}:icon`, overrideIconClass);
  }

  return shape;
}

function toFiniteNumber(value: any): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Reads `width`/`height` (or bpmn-prefixed) out of `attributes` and returns them as a shape-size object. */
function takeSize(attributes: Record<string, any>): { width?: number; height?: number } {
  const width = toFiniteNumber(attributes['bpmn:width'] ?? attributes.width);
  const height = toFiniteNumber(attributes['bpmn:height'] ?? attributes.height);

  delete attributes['bpmn:width'];
  delete attributes['bpmn:height'];
  delete attributes.width;
  delete attributes.height;

  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}
