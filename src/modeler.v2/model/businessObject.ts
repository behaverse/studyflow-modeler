/**
 * v2-compatible getBusinessObject adapter.
 *
 * In bpmn-js, elements have a .businessObject property wrapping the moddle object.
 * In v2, React Flow node.data.businessObject IS the moddle object.
 * This adapter provides a consistent way to extract the business object.
 */

/** Get the moddle business object from a v2 node data, a v1 element, or a raw BO. */
export function getBusinessObject(elementOrData: any): any {
  if (!elementOrData) return null;

  // v2 React Flow node data
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
