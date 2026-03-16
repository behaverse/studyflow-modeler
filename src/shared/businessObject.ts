/**
 * Standalone getBusinessObject adapter — no bpmn-js dependency.
 *
 * Handles:
 *   - v2 React Flow node data  (node.data.businessObject)
 *   - v1 diagram-js elements   (element.businessObject)
 *   - Raw moddle business objects (element.$type)
 */
export function getBusinessObject(elementOrData: any): any {
  if (!elementOrData) return null;

  // v1/v2 element wrapper
  if (elementOrData.businessObject) {
    return elementOrData.businessObject;
  }

  // Already a moddle business object (has $type)
  if (elementOrData.$type) {
    return elementOrData;
  }

  // v2 React Flow node — dig into data
  if (elementOrData.data?.businessObject) {
    return elementOrData.data.businessObject;
  }

  return elementOrData;
}
