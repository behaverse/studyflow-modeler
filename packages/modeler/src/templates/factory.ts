import { StudyflowElement, getDefaults } from '@core/element';
import { toPrefix } from '@core/naming';
import { bpmnSelfAndAncestors } from '@core/notation';
import type { Template, TemplateFlowConnection, TemplateFlowElement, TemplateFlowNode } from '@core/notation';

/** Stash key on a container shape for the nested flow elements to materialize once the root lands. */
export const TEMPLATE_FLOW_ELEMENTS = '__studyflowTemplateFlowElements';

const isFlowNode = (e: TemplateFlowElement): e is TemplateFlowNode => e.kind === 'node';
const isFlowConnection = (e: TemplateFlowElement): e is TemplateFlowConnection =>
  e.kind === 'connection';

type Box = { x: number; y: number; width: number; height: number };

function createWaypoints(source: Box, target: Box): Array<{ x: number; y: number }> {
  return [
    { x: source.x + source.width / 2, y: source.y + source.height / 2 },
    { x: target.x + target.width / 2, y: target.y + target.height / 2 },
  ];
}

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


type CreateTemplateConnectionParams = {
  elementFactory: any;
  definition: {
    id?: string;
    bpmnType: string;
    templateAttributes?: Record<string, any>;
  };
  source: any;
  target: any;
  parent: any;
};

export function createTemplateConnection(
  command: CreateTemplateConnectionParams,
): any {
  const { elementFactory, definition, source, target, parent } = command;
  const attributes: Record<string, any> = { ...(definition.templateAttributes || {}) };

  const connection = elementFactory.create('connection', {
    type: definition.bpmnType,
    source,
    target,
    parent,
    waypoints: createWaypoints(source, target),
  });

  const bo = connection.businessObject;

  if (definition.id) {
    bo.set('id', definition.id);
    connection.id = definition.id;
  }

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

  return connection;
}


type MaterializeTemplateFlowParams = {
  modeling: any;
  elementFactory: any;
  moddle: any;
  shape: any;
  hintKey: string;
};

/** Left covers the pool's label band. */
const POOL_PADDING = { left: 70, right: 40 };

/** Participants hold their flow inline (no drilldown plane), so grow the pool around the template's bounding box and shift the nodes into it. */
function fitParticipant(modeling: any, shape: any, nodeShapes: Box[]): { x: number; y: number } {
  if (shape?.businessObject?.$type !== 'bpmn:Participant' || nodeShapes.length === 0) return { x: 0, y: 0 };

  const minX = Math.min(...nodeShapes.map((n) => n.x));
  const minY = Math.min(...nodeShapes.map((n) => n.y));
  const bboxWidth = Math.max(...nodeShapes.map((n) => n.x + n.width)) - minX;
  const bboxHeight = Math.max(...nodeShapes.map((n) => n.y + n.height)) - minY;

  const width = Math.max(shape.width, bboxWidth + POOL_PADDING.left + POOL_PADDING.right);
  const height = Math.max(shape.height, bboxHeight + 80);
  modeling.resizeShape(shape, { x: shape.x, y: shape.y, width, height });

  return {
    x: shape.x + POOL_PADDING.left - minX,
    y: shape.y + Math.round((height - bboxHeight) / 2) - minY,
  };
}

export function materializeTemplateFlow(command: MaterializeTemplateFlowParams): void {
  const { modeling, elementFactory, moddle, shape, hintKey } = command;

  const flowElements: TemplateFlowElement[] = shape[TEMPLATE_FLOW_ELEMENTS] ?? [];
  if (flowElements.length === 0) return;

  const nodesById = new Map<string, any>();
  const nodeShapes = flowElements
    .filter(isFlowNode)
    .map((node) => ({ node, nodeShape: createTemplateShape({ elementFactory, moddle, ...node, parent: shape }) }));

  const delta = fitParticipant(modeling, shape, nodeShapes.map((entry) => entry.nodeShape));

  for (const { node, nodeShape } of nodeShapes) {
    const created = modeling.createShape(
      nodeShape,
      { x: nodeShape.x + delta.x, y: nodeShape.y + delta.y, width: nodeShape.width, height: nodeShape.height },
      shape,
      { autoResize: false, [hintKey]: true },
    );
    nodesById.set(node.id, created);
  }

  for (const conn of flowElements.filter(isFlowConnection)) {
    const source = nodesById.get(conn.sourceRef);
    const target = nodesById.get(conn.targetRef);
    if (!source || !target) {
      console.warn(`[templates] Skipping connection '${conn.id ?? conn.bpmnType}' - source or target not found.`);
      continue;
    }
    const created = createTemplateConnection({ elementFactory, definition: conn, source, target, parent: shape });
    modeling.createConnection(source, target, created, shape, { [hintKey]: true });
  }

  delete shape[TEMPLATE_FLOW_ELEMENTS];
}


type CreateTemplateShapeParams = {
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

function writeFields(target: any, fields: Record<string, any>): void {
  const handle = StudyflowElement.fromBusinessObject(target);
  for (const [name, value] of Object.entries(fields)) handle.setAttribute(name, value);
}

export function createTemplateShape(
  command: CreateTemplateShapeParams,
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

  const loop = attributes['loopCharacteristics'];
  if (loop && typeof loop === 'object') {
    delete attributes['loopCharacteristics'];
    const { type: loopType = 'bpmn:StandardLoopCharacteristics', ...fields } = loop as Record<string, any>;
    const lc = moddle.create(loopType, {});
    lc.$parent = bo;
    writeFields(lc, fields);
    bo.set('loopCharacteristics', lc);
  }

  const eventDefinitions = attributes['eventDefinitions'];
  if (Array.isArray(eventDefinitions)) {
    delete attributes['eventDefinitions'];
    bo.set('eventDefinitions', eventDefinitions.map((definition: Record<string, any>) => {
      const { type: definitionType, ...fields } = definition;
      const eventDefinition = moddle.create(definitionType, {});
      eventDefinition.$parent = bo;
      writeFields(eventDefinition, fields);
      return eventDefinition;
    }));
  }

  if (!extensionType) {
    const handle = StudyflowElement.fromBusinessObject(bo);
    for (const [name, value] of Object.entries(attributes)) handle.setAttribute(name, value);
    return shape;
  }

  const ext = StudyflowElement.fromBusinessObject(bo).ensureExtension(extensionType, moddle, attributes);

  if (overrideIconClass) {
    const extPrefix = toPrefix(extensionType);
    if (extPrefix) ext?.set?.(`${extPrefix}:icon`, overrideIconClass);
  }

  return shape;
}

/** A detached shape for `template`; a nested flow is stashed under {@link TEMPLATE_FLOW_ELEMENTS} for the host to materialize. */
export function createTemplateElement(template: Template, elementFactory: any, moddle: any): any {
  const shape = createTemplateShape({
    elementFactory,
    moddle,
    bpmnType: template.bpmnType,
    extensionType: template.extensionType,
    templateAttributes: template.templateAttributes,
    overrideIconClass: template.overrideIconClass,
  });
  const holdsFlow = template.bpmnType === 'bpmn:Participant'
    || bpmnSelfAndAncestors(template.bpmnType).includes('bpmn:SubProcess');
  if (template.flowElements?.length && holdsFlow) shape[TEMPLATE_FLOW_ELEMENTS] = template.flowElements;
  return shape;
}
