import { setRawAttribute } from '@/lib/core/extensions';

type CreateTemplateConnectionCommand = {
  type: 'create-template-connection';
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

export function runCreateTemplateConnection(
  command: CreateTemplateConnectionCommand,
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

  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('bpmn:')) setRawAttribute(bo, key, value);
    else bo.set(key, value);
  }

  return connection;
}

function createWaypoints(source: any, target: any): Array<{ x: number; y: number }> {
  return [
    { x: source.x + source.width / 2,  y: source.y + source.height / 2 },
    { x: target.x + target.width / 2,  y: target.y + target.height / 2 },
  ];
}
