import { executeCommand } from '../commands';
import { buildBusinessObject, buildShape } from '../commands/shape';

/**
 * Create a BPMN shape and place it at a fixed position (non-drag).
 *
 * @param modeler       - The bpmn-js modeler instance
 * @param bpmnType      - The base BPMN element type (e.g., "bpmn:Task")
 * @param position      - Where to place the shape on the canvas
 * @param attrs         - Optional business object attributes (name, etc.)
 * @param studyflowType - Optional studyflow extension type (e.g., "studyflow:CognitiveTask")
 */
export function createAndPlace(
  modeler: any,
  bpmnType: string,
  position: { x: number; y: number },
  attrs: Record<string, unknown> = {},
  studyflowType?: string,
) {
  const elementFactory = modeler.get('elementFactory');
  const canvas = modeler.get('canvas');
  const modeling = modeler.get('modeling');

  const businessObject = buildBusinessObject(modeler, bpmnType, { attrs, studyflowType });
  const shape = buildShape(elementFactory, bpmnType, businessObject);

  executeCommand(modeling, {
    type: 'create-shape',
    shape,
    position,
    parent: canvas.getRootElement(),
  });

  return shape;
}

/**
 * Start a drag-create flow from a DOM event (like the palette drag).
 *
 * @param modeler       - The bpmn-js modeler instance
 * @param bpmnType      - The base BPMN element type
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
  const elementFactory = modeler.get('elementFactory');
  const create = modeler.get('create');

  const businessObject = buildBusinessObject(modeler, bpmnType, { attrs, studyflowType });
  const shape = buildShape(elementFactory, bpmnType, businessObject);

  create.start(event, shape);
  return shape;
}
