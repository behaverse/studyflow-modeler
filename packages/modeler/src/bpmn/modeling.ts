import type { AttributeUpdater } from '@core/element';

/** updates via bpmn-js `modeling` */
export function modelingUpdater(modeling: any): AttributeUpdater {
  return {
    update(element, target, props) {
      if (target === (element?.businessObject ?? element)) modeling.updateProperties(element, props);
      else modeling.updateModdleProperties(element, target, props);
    },
  };
}
