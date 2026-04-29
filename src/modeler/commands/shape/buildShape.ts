/**
 * Thin wrapper around `elementFactory.createShape`.
 * Kept as a helper so every shape-creation path funnels through one call.
 */
export function buildShape(
  elementFactory: any,
  bpmnType: string,
  businessObject: any,
): any {
  return elementFactory.createShape({
    type: bpmnType,
    businessObject,
  });
}
