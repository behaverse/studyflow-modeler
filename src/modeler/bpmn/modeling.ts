import type { AttributeUpdater } from '@/core/element';

/** Routes updates through bpmn-js `modeling`, so each one is a single undo step.
 *  Whether the target is the element's own business object decides which call applies. */
export function modelingUpdater(modeling: any): AttributeUpdater {
  return {
    update(element, target, props) {
      if (target === (element?.businessObject ?? element)) modeling.updateProperties(element, props);
      else modeling.updateModdleProperties(element, target, props);
    },
  };
}
