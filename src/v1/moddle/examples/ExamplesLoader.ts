/**
 * Reads schema-level `examples` from moddle packages and builds
 * ElementExample descriptors by matching each example to its
 * corresponding type in the moddle registry.
 *
 * Injects the generated examples into the `elementTemplates` DI service.
 */

import type {
  Example,
  ExampleFlowConnection,
  ExampleFlowElement,
  ExampleFlowNode,
} from './types';

const RESERVED_EXAMPLE_KEYS = new Set([
  'type',
  'name',
  'keywords',
  'icon',
  'mixins',
  'flowElements',
]);

const RESERVED_FLOW_NODE_KEYS = new Set([
  'id',
  'x',
  'y',
  'type',
  'name',
  'keywords',
  'icon',
  'mixins',
  'flowElements',
]);

const RESERVED_FLOW_CONNECTION_KEYS = new Set([
  'id',
  'type',
  'bpmn:type',
  'sourceRef',
  'targetRef',
]);

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

  private _resolveTypeDescriptor(typeRef: string, prefix: string): any {
    const typeMap: Record<string, any> = this._moddle.registry.typeMap;
    const localName = typeRef.includes(':') ? typeRef.slice(typeRef.indexOf(':') + 1) : typeRef;
    const candidates = [typeRef, `${prefix}:${localName}`, localName];

    for (const candidate of candidates) {
      if (typeMap[candidate]) {
        return typeMap[candidate];
      }
    }

    try {
      return this._moddle.getTypeDescriptor(typeRef);
    } catch {
      return undefined;
    }
  }

  private _getDefaultProperties(typeDescriptor: any): Record<string, any> {
    const defaults: Record<string, any> = {};

    for (const property of typeDescriptor?.properties ?? []) {
      if (property.default !== undefined) {
        defaults[property.name] = property.default;
      }
    }

    return defaults;
  }

  private _resolveExampleMixins(
    obj: Record<string, any>,
    prefix: string,
  ): {
    bpmnTypeOverride?: string;
    properties: Record<string, any>;
  } {
    const mixins = Array.isArray(obj.mixins) ? obj.mixins : [];
    const properties: Record<string, any> = {};
    let bpmnTypeOverride: string | undefined;

    for (const mixinRef of mixins) {
      if (typeof mixinRef !== 'string' || mixinRef.trim() === '') {
        continue;
      }

      const descriptor = this._resolveTypeDescriptor(mixinRef, prefix);
      if (!descriptor) {
        console.warn(`[examples-loader] Unable to resolve mixin '${mixinRef}'`);
        continue;
      }

      Object.assign(properties, this._getDefaultProperties(descriptor));

      if (mixinRef.startsWith('bpmn:')) {
        bpmnTypeOverride = mixinRef;
      }
    }

    return { bpmnTypeOverride, properties };
  }

  private _extractProperties(
    obj: Record<string, any>,
    reservedKeys: Set<string>,
  ): Record<string, any> {
    const properties: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (!reservedKeys.has(key) && value !== undefined) {
        properties[key] = value;
      }
    }

    return properties;
  }

  private _resolveSchemaTypeDescriptor(
    typeName: string,
    prefix: string,
    typeMap: Record<string, any>,
  ): { qualifiedName: string; typeDescriptor: any } | null {
    const qualifiedName = typeName.includes(':') ? typeName : `${prefix}:${typeName}`;
    const typeDescriptor = typeMap[qualifiedName];

    if (!typeDescriptor) {
      return null;
    }

    if (typeDescriptor.isAbstract || typeDescriptor.extends?.length) {
      return null;
    }

    return {
      qualifiedName,
      typeDescriptor,
    };
  }

  private _normalizeFlowNode(
    entry: Record<string, any>,
    prefix: string,
    typeMap: Record<string, any>,
  ): ExampleFlowNode | null {
    const entryType = entry?.type;
    if (typeof entryType !== 'string' || entryType.trim() === '') {
      return null;
    }

    const mixinData = this._resolveExampleMixins(entry, prefix);
    const mergedEntry: Record<string, any> = {
      ...mixinData.properties,
      ...entry,
    };

    let studyflowType: string | undefined;
    let bpmnType: string | undefined;
    let typeDescriptor: any;

    if (mergedEntry.type.startsWith('bpmn:')) {
      typeDescriptor = this._resolveTypeDescriptor(mergedEntry.type, prefix);
      bpmnType = mixinData.bpmnTypeOverride ?? mergedEntry.type;
    } else {
      const resolved = this._resolveSchemaTypeDescriptor(mergedEntry.type, prefix, typeMap);
      if (!resolved) {
        return null;
      }

      studyflowType = resolved.qualifiedName;
      typeDescriptor = resolved.typeDescriptor;
      bpmnType = mixinData.bpmnTypeOverride ?? resolved.typeDescriptor.meta?.bpmnType;
    }

    if (!bpmnType) {
      return null;
    }

    return {
      id: String(mergedEntry.id),
      kind: 'node',
      studyflowType,
      bpmnType,
      iconClass: mergedEntry.icon ?? typeDescriptor?.icon,
      exampleProperties: this._extractProperties(mergedEntry, RESERVED_FLOW_NODE_KEYS),
      x: typeof mergedEntry.x === 'number' ? mergedEntry.x : undefined,
      y: typeof mergedEntry.y === 'number' ? mergedEntry.y : undefined,
    };
  }

  private _normalizeFlowConnection(
    entry: Record<string, any>,
  ): ExampleFlowConnection | null {
    const bpmnType = entry?.['bpmn:type'] ?? entry?.type;
    const sourceRef = entry?.sourceRef;
    const targetRef = entry?.targetRef;

    if (
      typeof bpmnType !== 'string'
      || typeof sourceRef !== 'string'
      || typeof targetRef !== 'string'
    ) {
      return null;
    }

    return {
      id: typeof entry.id === 'string' ? entry.id : undefined,
      kind: 'connection',
      bpmnType,
      sourceRef,
      targetRef,
      exampleProperties: this._extractProperties(entry, RESERVED_FLOW_CONNECTION_KEYS),
    };
  }

  private _normalizeFlowElements(
    obj: Record<string, any>,
    prefix: string,
    typeMap: Record<string, any>,
  ): ExampleFlowElement[] | undefined {
    if (!Array.isArray(obj.flowElements) || obj.flowElements.length === 0) {
      return undefined;
    }

    const normalized: ExampleFlowElement[] = [];

    for (const entry of obj.flowElements) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      if (
        typeof entry.sourceRef === 'string'
        && typeof entry.targetRef === 'string'
        && (typeof entry.type === 'string' || typeof entry['bpmn:type'] === 'string')
      ) {
        const connection = this._normalizeFlowConnection(entry);
        if (connection) {
          normalized.push(connection);
        }
        continue;
      }

      if (typeof entry.type === 'string') {
        const node = this._normalizeFlowNode(entry, prefix, typeMap);
        if (node) {
          normalized.push(node);
        }
        continue;
      }
    }

    return normalized.length > 0 ? normalized : undefined;
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
        const exampleType = obj?.type;
        if (!exampleType) continue;

        const mixinData = this._resolveExampleMixins(obj, prefix);
        const mergedObject: Record<string, any> = {
          ...mixinData.properties,
          ...obj,
        };

        // Resolve the qualified type name
        const typeName: string = mergedObject.type;
        const qualifiedName = typeName.includes(':') ? typeName : `${prefix}:${typeName}`;

        // Look up the type in the registry
        const typeDescriptor = typeMap[qualifiedName];
        if (!typeDescriptor) continue;

        // Skip abstract types
        if (typeDescriptor.isAbstract) continue;

        // Skip extends-based types (their properties live on the BPMN element)
        if (typeDescriptor.extends?.length) continue;

        // Must have a BPMN base type to be creatable as a shape
        const bpmnType: string | undefined = mixinData.bpmnTypeOverride ?? typeDescriptor.meta?.bpmnType;
        if (!bpmnType) continue;

        const iconClass: string | undefined = mergedObject.icon ?? typeDescriptor.icon;

        // Extract example properties (excluding metadata fields)
        const exampleProperties = this._extractProperties(mergedObject, RESERVED_EXAMPLE_KEYS);
        const flowElements = this._normalizeFlowElements(mergedObject, prefix, typeMap);

        const exampleName = mergedObject.name ?? mergedObject['bpmn:name'] ?? typeName;
        const exampleEntry: Example = {
          // Use a per-example id so multiple examples for the same type
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
          keywords: mergedObject.keywords ?? [],
          studyflowType: qualifiedName,
          bpmnType,
          iconClass,
          exampleProperties: Object.keys(exampleProperties).length > 0 ? exampleProperties : undefined,
          flowElements,
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
