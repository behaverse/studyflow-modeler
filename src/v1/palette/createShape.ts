// Helper to create and place a BPMN/Studyflow shape.
export function createAndPlace(
  modeler: any,
  type: string,
  position: { x: number; y: number },
  attrs: Record<string, unknown> = {},
) {
  const bpmnFactory = modeler.get('bpmnFactory');
  const elementFactory = modeler.get('elementFactory');
  const modeling = modeler.get('modeling');
  const canvas = modeler.get('canvas');

  const root = canvas.getRootElement();

  const prefix = type.includes(':') ? type.split(':')[1] : type;
  const businessObject = bpmnFactory.create(type, {
    ...attrs,
  });

  // Use moddle id generator
  businessObject.id = businessObject.id
    || bpmnFactory._model.ids.nextPrefixed(`${prefix}_`, businessObject);

  const shape = elementFactory.createShape({
    type,
    businessObject,
  });

  modeling.createShape(shape, position, root);

  return shape;
}

// Start drag-create flow (like palette drag) from a DOM/native event.
export function startCreate(
  modeler: any,
  type: string,
  event: MouseEvent | any,
  attrs: Record<string, unknown> = {},
) {
  const bpmnFactory = modeler.get('bpmnFactory');
  const elementFactory = modeler.get('elementFactory');
  const create = modeler.get('create');

  const prefix = type.includes(':') ? type.split(':')[1] : type;
  const businessObject = bpmnFactory.create(type, {
    ...attrs,
  });

  businessObject.id = businessObject.id
    || bpmnFactory._model.ids.nextPrefixed(`${prefix}_`, businessObject);

  const shape = elementFactory.createShape({
    type,
    businessObject,
  });

  create.start(event, shape);

  return shape;
}