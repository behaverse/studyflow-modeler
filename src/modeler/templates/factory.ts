import { StudyflowElement, getDefaults } from '@/core/element';
import { toPrefix } from '@/core/naming';
import { TEMPLATE_FLOW_ELEMENTS } from '@/modeler/templates/Templates';
import type { TemplateFlowConnection, TemplateFlowElement, TemplateFlowNode } from '@/core/notation';

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
  templatesService: {
    createFlowNodeShape: (definition: TemplateFlowNode, parent: any) => any;
    createFlowConnection: (
      definition: TemplateFlowConnection,
      source: any,
      target: any,
      parent: any,
    ) => any;
  };
  shape: any;
  newRootElement?: any;
  hintKey: string;
};

export function materializeTemplateFlow(command: MaterializeTemplateFlowParams): void {
  const { modeling, templatesService, shape, newRootElement, hintKey } = command;

  const flowElements: TemplateFlowElement[] = shape[TEMPLATE_FLOW_ELEMENTS] ?? [];
  if (flowElements.length === 0) return;

  const flowContainer = newRootElement ?? shape;
  const nodesById = new Map<string, any>();

  for (const node of flowElements.filter(isFlowNode)) {
    const nodeShape = templatesService.createFlowNodeShape(node, flowContainer);
    const created = modeling.createShape(
      nodeShape,
      { x: nodeShape.x, y: nodeShape.y, width: nodeShape.width, height: nodeShape.height },
      flowContainer,
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
    const created = templatesService.createFlowConnection(conn, source, target, flowContainer);
    modeling.createConnection(source, target, created, flowContainer, { [hintKey]: true });
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
