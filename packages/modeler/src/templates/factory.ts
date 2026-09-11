import { defaultSizeFor, isExpandable, type Canvas, type SceneNode, type ShapeDescriptor } from '@canvas/index.ts';
import { StudyflowElement, getDefaults } from '@core/element';
import { toPrefix } from '@core/naming';
import { bpmnSelfAndAncestors } from '@core/notation';
import type { Template, TemplateFlowConnection, TemplateFlowElement, TemplateFlowNode } from '@core/notation';
import type { EditorModel, ModelElement } from '@modeler/editor/port';

/** A template's shape, built and sized but not on the canvas yet; `x`/`y` are where a template's flow lays it out. */
export type TemplateShape = ShapeDescriptor & {
  businessObject: ModelElement;
  width: number;
  height: number;
  x?: number;
  y?: number;
};

const isFlowNode = (e: TemplateFlowElement): e is TemplateFlowNode => e.kind === 'node';
const isFlowConnection = (e: TemplateFlowElement): e is TemplateFlowConnection =>
  e.kind === 'connection';

function toFiniteNumber(value: any): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

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

/** A template connection's business object, name and attributes written, for `connectElements` to file. */
function createTemplateConnection(model: EditorModel, definition: TemplateFlowConnection): ModelElement {
  const bo = model.createBusinessObject(definition.bpmnType);
  const attributes: Record<string, any> = { ...(definition.templateAttributes || {}) };

  const bpmnName = attributes['bpmn:name'];
  if (bpmnName !== undefined) {
    delete attributes['bpmn:name'];
    bo.set('name', bpmnName);
  }

  const handle = StudyflowElement.fromBusinessObject(bo);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('bpmn:')) bo.set(key, value);
    else handle.setAttribute(key, value);
  }
  return bo;
}

/** Left covers the pool's label band. */
const POOL_PADDING = { left: 70, right: 40 };

/** Participants hold their flow inline (no drilldown), so grow the pool around the template's bounding box; returns the shift that moves the nodes into it. */
function fitParticipant(canvas: Canvas, pool: SceneNode, shapes: TemplateShape[]): { x: number; y: number } {
  if (pool.type !== 'bpmn:Participant' || shapes.length === 0) return { x: 0, y: 0 };

  const minX = Math.min(...shapes.map((n) => n.x ?? 0));
  const minY = Math.min(...shapes.map((n) => n.y ?? 0));
  const bboxWidth = Math.max(...shapes.map((n) => (n.x ?? 0) + n.width)) - minX;
  const bboxHeight = Math.max(...shapes.map((n) => (n.y ?? 0) + n.height)) - minY;

  const width = Math.max(pool.width, bboxWidth + POOL_PADDING.left + POOL_PADDING.right);
  const height = Math.max(pool.height, bboxHeight + 80);
  canvas.resizeShape(pool, { x: pool.x, y: pool.y, width, height });

  return {
    x: pool.x + POOL_PADDING.left - minX,
    y: pool.y + Math.round((height - bboxHeight) / 2) - minY,
  };
}

/** Lay `flowElements` out inside `container`, the shape their template was dropped as. */
export function materializeTemplateFlow(
  canvas: Canvas,
  model: EditorModel,
  container: SceneNode,
  flowElements: TemplateFlowElement[],
): void {
  const nodes = flowElements.filter(isFlowNode).map((node) => ({ id: node.id, shape: createTemplateShape(model, node) }));
  const shift = fitParticipant(canvas, container, nodes.map((entry) => entry.shape));

  const placed = new Map<string, SceneNode>();
  for (const { id, shape } of nodes) {
    const bounds = { x: (shape.x ?? 0) + shift.x, y: (shape.y ?? 0) + shift.y, width: shape.width, height: shape.height };
    const node = canvas.addElement(shape, bounds, container);
    if (node) placed.set(id, node);
  }

  for (const connection of flowElements.filter(isFlowConnection)) {
    const source = placed.get(connection.sourceRef);
    const target = placed.get(connection.targetRef);
    if (!source || !target) {
      console.warn(`[templates] Skipping connection '${connection.id ?? connection.bpmnType}' - source or target not found.`);
      continue;
    }
    canvas.connectElements(source, target, createTemplateConnection(model, connection));
  }
}


type TemplateShapeSpec = Pick<TemplateFlowNode, 'bpmnType' | 'extensionType' | 'overrideIconClass' | 'templateAttributes' | 'x' | 'y'> & {
  isExpanded?: boolean;
};

function writeFields(target: any, fields: Record<string, any>): void {
  const handle = StudyflowElement.fromBusinessObject(target);
  for (const [name, value] of Object.entries(fields)) handle.setAttribute(name, value);
}

function createTemplateShape(model: EditorModel, spec: TemplateShapeSpec): TemplateShape {
  const { bpmnType, extensionType, overrideIconClass, templateAttributes, x, y, isExpanded } = spec;

  const defaults = extensionType ? getDefaults(extensionType) : {};
  const attributes: Record<string, any> = { ...defaults, ...(templateAttributes || {}) };
  const size = { ...defaultSizeFor(bpmnType, isExpanded), ...takeSize(attributes) };

  const bo = model.createBusinessObject(bpmnType);
  const shape: TemplateShape = {
    type: bpmnType,
    businessObject: bo,
    ...size,
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(isExpanded !== undefined ? { isExpanded } : {}),
  };

  const bpmnName = attributes['bpmn:name'];
  if (bpmnName !== undefined) {
    delete attributes['bpmn:name'];
    bo.set('name', bpmnName);
  }

  const loop = attributes['loopCharacteristics'];
  if (loop && typeof loop === 'object') {
    delete attributes['loopCharacteristics'];
    const { type: loopType = 'bpmn:StandardLoopCharacteristics', ...fields } = loop as Record<string, any>;
    const lc = model.create(loopType, {});
    lc.$parent = bo;
    writeFields(lc, fields);
    bo.set('loopCharacteristics', lc);
  }

  const eventDefinitions = attributes['eventDefinitions'];
  if (Array.isArray(eventDefinitions)) {
    delete attributes['eventDefinitions'];
    bo.set('eventDefinitions', eventDefinitions.map((definition: Record<string, any>) => {
      const { type: definitionType, ...fields } = definition;
      const eventDefinition = model.create(definitionType, {});
      eventDefinition.$parent = bo;
      writeFields(eventDefinition, fields);
      return eventDefinition;
    }));
  }

  if (!extensionType) {
    writeFields(bo, attributes);
    return shape;
  }

  const ext = StudyflowElement.fromBusinessObject(bo).ensureExtension(extensionType, model.moddle(), attributes);

  if (overrideIconClass) {
    const extPrefix = toPrefix(extensionType);
    if (extPrefix) ext?.set?.(`${extPrefix}:icon`, overrideIconClass);
  }

  return shape;
}

/** The shape a palette drag drops for `template`, and the flow to lay out inside it once it lands. */
export function createTemplateElement(
  model: EditorModel,
  template: Template,
): { shape: TemplateShape; flowElements: TemplateFlowElement[] } {
  const shape = createTemplateShape(model, {
    bpmnType: template.bpmnType,
    extensionType: template.extensionType,
    templateAttributes: template.templateAttributes,
    overrideIconClass: template.overrideIconClass,
    // A container arrives collapsed, like a plain one from the palette; its flow is drawn once drilled into.
    ...(isExpandable(template.bpmnType) ? { isExpanded: false } : {}),
  });
  const holdsFlow = template.bpmnType === 'bpmn:Participant'
    || bpmnSelfAndAncestors(template.bpmnType).includes('bpmn:SubProcess');
  return { shape, flowElements: holdsFlow ? template.flowElements ?? [] : [] };
}
