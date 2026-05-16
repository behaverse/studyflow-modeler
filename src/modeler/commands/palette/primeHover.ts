/** Prime the dragger's hover state so CreatePreview renders immediately after a popup click. */
export function primeHoverFromEvent(modeler: any, event: MouseEvent | any): void {
  if (!event || typeof event.clientX !== 'number') return;

  const dragging = modeler.get('dragging');
  const canvas = modeler.get('canvas');
  const elementRegistry = modeler.get('elementRegistry');
  const rootElement = canvas.getRootElement();
  const rootGfx = elementRegistry.getGraphics(rootElement);

  dragging.hover({ element: rootElement, gfx: rootGfx });
  dragging.move(event);
}
