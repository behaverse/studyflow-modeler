/**
 * Reads schema-level `examples` from moddle packages and builds
 * ElementExample descriptors by matching each example to its
 * corresponding type in the moddle registry.
 *
 * Injects the generated examples into the `elementTemplates` DI service.
 */

import { runBuildExamplesRegistry } from '../../commands/examples';

export default class ExamplesLoader {

  static $inject = [
    'elementTemplates',
    'moddle',
    'eventBus'
  ];

  private _elementExamplesService: any;
  private _moddle: any;

  constructor(
    elementTemplates: any,
    moddle: any,
    eventBus: any,
  ) {
    this._elementExamplesService = elementTemplates;
    this._moddle = moddle;

    // Build examples once the moddle registry is ready.
    // The registry is populated synchronously during modeler construction,
    // so by the time DI resolves __init__ services the types are available.
    eventBus.on('diagram.init', () => {
      this._loadExamples();
    });
  }

  private _loadExamples(): void {
    const examplesOut = runBuildExamplesRegistry({
      type: 'build-examples-registry',
      moddle: this._moddle,
    });

    this._elementExamplesService.set(examplesOut);
  }
}
