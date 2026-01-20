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

  const ids = bpmnFactory?._model?.ids;
  const idPrefix = `${type.replace(/[^A-Za-z0-9_]/g, '_')}_`;
  const generatedId = (attrs as { id?: string }).id
    ?? (ids?.nextPrefixed ? ids.nextPrefixed(idPrefix, { $type: type } as any) : undefined);

  const businessObject = bpmnFactory.create(type, {
    ...attrs,
    ...(generatedId ? { id: generatedId } : {}),
  });

  // Safety net: ensure we always have an id
  businessObject.id = businessObject.id
    || (ids?.nextPrefixed ? ids.nextPrefixed(idPrefix, businessObject) : undefined);

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
  const generatedId = bpmnFactory._model.ids.nextPrefixed(`${prefix}_`);
  const businessObject = bpmnFactory.create(type, {
    ...attrs,
    ...{ id: generatedId },
  });

  // Safety net: ensure we always have an id
  businessObject.id = businessObject.id || generatedId;

  const shape = elementFactory.createShape({
    type,
    businessObject,
  });

  create.start(event, shape);

  return shape;
}