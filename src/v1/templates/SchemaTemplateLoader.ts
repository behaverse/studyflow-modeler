/**
 * Reads schema-level `examples` from moddle packages and builds
 * ElementTemplate descriptors by matching each example to its
 * corresponding type in the moddle registry.
 *
 * Injects the generated templates into the ElementTemplates service.
 */

import type { ElementTemplate } from './types';

/**
 * Convert an icon class string like "iconify bi--puzzle" to an
 * Iconify API SVG URL suitable for use as `imageUrl` in popup menus.
 *
 * Returns undefined if the icon class doesn't match the expected format.
 */
function iconClassToUrl(iconClass: string | undefined): string | undefined {
  if (!iconClass) return undefined;

  // Format: "iconify {set}--{name}"
  const match = iconClass.match(/^iconify\s+(.+?)--(.+)$/);
  if (!match) return undefined;

  const [, set, name] = match;
  return `https://api.iconify.design/${set}/${name}.svg?height=18`;
}

export default class SchemaTemplateLoader {

  static $inject = [
    'elementTemplates',
    'moddle',
    'eventBus'
  ];

  private _elementTemplates: any;
  private _moddle: any;

  constructor(
    elementTemplates: any,
    moddle: any,
    eventBus: any,
  ) {
    this._elementTemplates = elementTemplates;
    this._moddle = moddle;

    // Build templates once the moddle registry is ready.
    // The registry is populated synchronously during modeler construction,
    // so by the time DI resolves __init__ services the types are available.
    eventBus.on('diagram.init', () => {
      this._loadTemplates();
    });
  }

  private _loadTemplates(): void {
    const packages: any[] = this._moddle.getPackages();
    const typeMap: Record<string, any> = this._moddle.registry.typeMap;
    const templates: ElementTemplate[] = [];

    for (const pkg of packages) {
      const examples: any[] = pkg.examples ?? [];
      const prefix: string = pkg.prefix;

      for (const example of examples) {
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

        const iconUrl = iconClassToUrl(typeDescriptor.icon);

        const template: ElementTemplate = {
          id: qualifiedName,
          name: obj.name ?? className,
          description: example.description ?? typeDescriptor.description ?? '',
          appliesTo: [bpmnType],
          elementType: { value: bpmnType },
          icon: iconUrl ? { contents: iconUrl } : undefined,
          category: {
            id: prefix,
            name: capitalize(prefix),
          },
          keywords: obj.keywords ?? [],
          studyflowType: qualifiedName,
          bpmnType,
          iconClass: typeDescriptor.icon,
        };

        templates.push(template);
      }
    }

    this._elementTemplates.set(templates);
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
