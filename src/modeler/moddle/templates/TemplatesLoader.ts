/**
 * Reads schema-level `templates` from moddle packages and builds
 * Template descriptors by matching each template to its corresponding
 * type in the moddle registry.
 *
 * Injects the generated templates into the `elementTemplates` DI service.
 */

import { runBuildTemplatesRegistry } from '../../commands/templates';

export default class TemplatesLoader {

  static $inject = [
    'elementTemplates',
    'moddle',
    'eventBus'
  ];

  private _elementTemplatesService: any;
  private _moddle: any;

  constructor(
    elementTemplates: any,
    moddle: any,
    eventBus: any,
  ) {
    this._elementTemplatesService = elementTemplates;
    this._moddle = moddle;

    // Build templates once the moddle registry is ready.
    // The registry is populated synchronously during modeler construction,
    // so by the time DI resolves __init__ services the types are available.
    eventBus.on('diagram.init', () => {
      this._loadTemplates();
    });
  }

  private _loadTemplates(): void {
    const templatesOut = runBuildTemplatesRegistry({
      type: 'build-templates-registry',
      moddle: this._moddle,
    });

    this._elementTemplatesService.set(templatesOut);
  }
}
