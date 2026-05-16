import { runBuildTemplatesRegistry } from '../../commands/templates';

/** Builds templates from moddle packages and registers them with `elementTemplates`. */
export default class TemplatesLoader {

  static $inject = ['elementTemplates', 'moddle', 'eventBus'];

  constructor(elementTemplates: any, moddle: any, eventBus: any) {
    eventBus.on('diagram.init', () => {
      const templates = runBuildTemplatesRegistry({ type: 'build-templates-registry', moddle });
      elementTemplates.set(templates);
    });
  }
}
