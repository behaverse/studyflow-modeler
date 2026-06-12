import { getCatalog } from '@/lib/core/catalog';

/** Registers the catalog's compiled templates with `elementTemplates`. */
export default class TemplatesLoader {

  static $inject = ['elementTemplates', 'eventBus'];

  constructor(elementTemplates: any, eventBus: any) {
    eventBus.on('diagram.init', () => {
      elementTemplates.set(getCatalog().allTemplates());
    });
  }
}
