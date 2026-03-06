/**
 * Reads schema-level `examples` from moddle packages and builds
 * ElementExample descriptors by matching each example to its
 * corresponding type in the moddle registry.
 *
 * Injects the generated examples into the `elementTemplates` DI service.
 */

import type { Example } from './types';

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
    const packages: any[] = this._moddle.getPackages();
    const typeMap: Record<string, any> = this._moddle.registry.typeMap;
    const examplesOut: Example[] = [];

    for (const pkg of packages) {
      const examples: any[] = pkg.examples ?? [];
      const prefix: string = pkg.prefix;

      for (const [index, example] of examples.entries()) {
        const obj = example?.object;
        if (!obj?.class) continue;

        // Resolve the qualified type name
        const className: string = obj.class;
        const qualifiedName = className.includes(':') ? className : `${prefix}:${className}`;

        // Look up the type in the registry
        const typeDescriptor = typeMap[qualifiedName];
        if (!typeDescriptor) continue;

        // Skip abstract types
        if (typeDescriptor.isAbstract) continue;

        // Skip extends-based types (their properties live on the BPMN element)
        if (typeDescriptor.extends?.length) continue;

        // Must have a BPMN base type to be creatable as a shape
        const bpmnType: string | undefined = typeDescriptor.meta?.bpmnType;
        if (!bpmnType) continue;

        const iconClass: string | undefined = obj.icon ?? typeDescriptor.icon;

        // Extract example properties (excluding metadata fields)
        const exampleProperties: Record<string, any> = {};
        for (const [key, value] of Object.entries(obj)) {
          if (key !== 'class' && key !== 'name' && key !== 'keywords' && key !== 'icon' && value !== undefined) {
            exampleProperties[key] = value;
          }
        }

        const exampleName = obj.name ?? obj['bpmn:name'] ?? className;
        const exampleEntry: Example = {
          // Use a per-example id so multiple examples for the same class
          // remain distinct in popup menus and do not overwrite each other.
          id: `${qualifiedName}::example:${index + 1}`,
          name: exampleName,
          description: example.description ?? typeDescriptor.description ?? '',
          appliesTo: [bpmnType],
          elementType: { value: bpmnType },
          category: {
            id: prefix,
            name: capitalize(prefix),
          },
          keywords: obj.keywords ?? [],
          studyflowType: qualifiedName,
          bpmnType,
          iconClass,
          exampleProperties: Object.keys(exampleProperties).length > 0 ? exampleProperties : undefined,
          templateSource: 'schema-example',
          schemaPrefix: prefix.toLowerCase(),
        };

        examplesOut.push(exampleEntry);
      }
    }

    this._elementExamplesService.set(examplesOut);
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
