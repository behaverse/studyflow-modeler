/**
 * Standalone getBusinessObject adapter — no bpmn-js dependency.
 *
 * Handles:
 *   - diagram-js elements   (element.businessObject)
 *   - Raw moddle business objects (element.$type)
 */
export function getBusinessObject(elementOrData: any): any {
  if (!elementOrData) return null;

  // Element wrapper
  if (elementOrData.businessObject) {
    return elementOrData.businessObject;
  }

  // Already a moddle business object (has $type)
  if (elementOrData.$type) {
    return elementOrData;
  }

  return elementOrData;
}
