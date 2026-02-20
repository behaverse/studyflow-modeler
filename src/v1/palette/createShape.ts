import { createStudyflowExtension, getStudyflowDefaults, isExtendsType } from '../extensionElements';

/**
 * Add a studyflow extension element wrapper to a business object with defaults.
 * Called during element creation (before the element is on the canvas).
 */
function attachStudyflowExtension(
  businessObject: any,
  studyflowType: string,
  moddle: any
): void {
  const defaults = getStudyflowDefaults(studyflowType, moddle);
  createStudyflowExtension(businessObject, studyflowType, moddle, defaults);
}

/**
 * Create and place a BPMN shape with an optional studyflow extension element.
 *
 * @param modeler      - The bpmn-js modeler instance
 * @param bpmnType     - The base BPMN element type (e.g., "bpmn:Task")
 * @param position     - Where to place the shape on the canvas
 * @param attrs        - Optional business object attributes (name, etc.)
 * @param studyflowType - Optional studyflow extension type (e.g., "studyflow:CognitiveTask")
 */
export function createAndPlace(
  modeler: any,
  bpmnType: string,
  position: { x: number; y: number },
  attrs: Record<string, unknown> = {},
  studyflowType?: string,
) {
  const bpmnFactory = modeler.get('bpmnFactory');
  const elementFactory = modeler.get('elementFactory');
  const modeling = modeler.get('modeling');
  const canvas = modeler.get('canvas');
  const moddle = bpmnFactory._model;

  const root = canvas.getRootElement();

  const ids = moddle?.ids;
  const prefix = studyflowType
    ? studyflowType.split(':')[1]
    : bpmnType.replace(/[^A-Za-z0-9_]/g, '_');
  const idPrefix = `${prefix}_`;

  const generatedId = (attrs as { id?: string }).id
    ?? (ids?.nextPrefixed ? ids.nextPrefixed(idPrefix, { $type: bpmnType } as any) : undefined);

  const businessObject = bpmnFactory.create(bpmnType, {
    ...attrs,
    ...(generatedId ? { id: generatedId } : {}),
  });

  businessObject.id = businessObject.id
    || (ids?.nextPrefixed ? ids.nextPrefixed(idPrefix, businessObject) : undefined);

  if (studyflowType) {
    if (isExtendsType(studyflowType, moddle)) {
      // extends-based type: apply defaults directly to the BO
      const defaults = getStudyflowDefaults(studyflowType, moddle);
      for (const [key, val] of Object.entries(defaults)) {
        businessObject.set(key, val);
      }
    } else {
      attachStudyflowExtension(businessObject, studyflowType, moddle);
    }
  }

  const shape = elementFactory.createShape({
    type: bpmnType,
    businessObject,
  });

  modeling.createShape(shape, position, root);

  return shape;
}

/**
 * Start drag-create flow (like palette drag) from a DOM/native event.
 *
 * @param modeler       - The bpmn-js modeler instance
 * @param bpmnType      - The base BPMN element type (e.g., "bpmn:Task")
 * @param event         - The DOM event that started the drag
 * @param attrs         - Optional business object attributes
 * @param studyflowType - Optional studyflow extension type
 */
export function startCreate(
  modeler: any,
  bpmnType: string,
  event: MouseEvent | any,
  attrs: Record<string, unknown> = {},
  studyflowType?: string,
) {
  const bpmnFactory = modeler.get('bpmnFactory');
  const elementFactory = modeler.get('elementFactory');
  const create = modeler.get('create');
  const moddle = bpmnFactory._model;

  const prefix = studyflowType
    ? studyflowType.split(':')[1]
    : (bpmnType.includes(':') ? bpmnType.split(':')[1] : bpmnType);
  const generatedId = moddle.ids.nextPrefixed(`${prefix}_`);

  // For extends-based types, merge defaults into the creation attributes
  let extendedDefaults: Record<string, any> = {};
  if (studyflowType && isExtendsType(studyflowType, moddle)) {
    extendedDefaults = getStudyflowDefaults(studyflowType, moddle);
  }

  const businessObject = bpmnFactory.create(bpmnType, {
    ...extendedDefaults,
    ...attrs,
    id: generatedId,
  });

  businessObject.id = businessObject.id || generatedId;

  if (studyflowType && !isExtendsType(studyflowType, moddle)) {
    attachStudyflowExtension(businessObject, studyflowType, moddle);
  }

  const shape = elementFactory.createShape({
    type: bpmnType,
    businessObject,
  });

  create.start(event, shape);

  return shape;
}