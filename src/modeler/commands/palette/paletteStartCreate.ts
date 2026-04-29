import { buildBusinessObject, buildShape } from '../shape';

export type PaletteStartCreateCommand = {
  type: 'palette-start-create';
  bpmnType: string;
  event: MouseEvent | any;
  attrs?: Record<string, unknown>;
  studyflowType?: string;
};

export function runPaletteStartCreate(
  modeler: any,
  command: PaletteStartCreateCommand,
): any {
  if (!modeler) {
    throw new Error("Command 'palette-start-create' requires a modeler instance.");
  }

  const businessObject = buildBusinessObject(modeler, command.bpmnType, {
    attrs: command.attrs,
    studyflowType: command.studyflowType,
  });

  const shape = buildShape(
    modeler.get('elementFactory'),
    command.bpmnType,
    businessObject,
  );

  modeler.get('create').start(command.event, shape);

  // diagram-js's CreatePreview only appends the dragger SVG to the canvas
  // when payload.hover is set (i.e. the cursor is over a canvas element).
  // Clicking a popup item doesn't trigger a canvas hover, so the first move
  // bails and the preview only shows after the user nudges into the canvas.
  // Prime hover with the root element, then call move() to position it.
  const evt = command.event as MouseEvent | undefined;
  if (evt && typeof evt.clientX === 'number') {
    const dragging = modeler.get('dragging');
    const canvas = modeler.get('canvas');
    const elementRegistry = modeler.get('elementRegistry');
    const rootElement = canvas.getRootElement();
    const rootGfx = elementRegistry.getGraphics(rootElement);
    dragging.hover({ element: rootElement, gfx: rootGfx });
    dragging.move(evt);
  }

  return shape;
}
