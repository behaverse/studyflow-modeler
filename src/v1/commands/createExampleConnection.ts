export type CreateExampleConnectionCommand = {
  type: 'create-example-connection';
  elementFactory: any;
  definition: {
    id?: string;
    bpmnType: string;
    exampleProperties?: Record<string, any>;
  };
  source: any;
  target: any;
  parent: any;
};

export function runCreateExampleConnection(
  command: CreateExampleConnectionCommand,
): any {
  const {
    elementFactory,
    definition,
    source,
    target,
    parent,
  } = command;
  const properties: Record<string, any> = {
    ...(definition.exampleProperties || {}),
  };

  const connection = elementFactory.create('connection', {
    type: definition.bpmnType,
    source,
    target,
    parent,
    waypoints: createWaypoints(source, target),
  });

  const businessObject = connection.businessObject;

  if (definition.id) {
    businessObject.set('id', definition.id);
    connection.id = definition.id;
  }

  const bpmnName = properties['bpmn:name'];
  if (bpmnName !== undefined) {
    delete properties['bpmn:name'];
    businessObject.set('name', bpmnName);
  }

  for (const [key, value] of Object.entries(properties)) {
    if (key.startsWith('bpmn:')) {
      setNamespacedAttr(businessObject, key, value);
      continue;
    }

    businessObject.set(key, value);
  }

  return connection;
}

function setNamespacedAttr(target: any, attrName: string, value: any): void {
  if (!target || value === undefined) {
    return;
  }

  if (typeof target.set === 'function') {
    try {
      target.set(attrName, value);
      return;
    } catch {
      // Fall through to direct $attrs mutation when supported.
    }
  }

  const attrs = target.$attrs;
  if (attrs && typeof attrs === 'object') {
    attrs[attrName] = value;
  }
}

function createWaypoints(source: any, target: any): Array<{ x: number; y: number }> {
  return [
    {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    },
    {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    },
  ];
}