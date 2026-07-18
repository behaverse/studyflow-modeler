import { setRawAttribute, StudyflowElement } from '@/core/extensions';
import { createWaypoints } from '@/modeler/models/shape/template';

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

  const handle = StudyflowElement.fromBusinessObject(bo);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('bpmn:')) setRawAttribute(bo, key, value);
    else handle.write(key, value);
  }

  return connection;
}
