import type {
  Example,
  ExampleFlowConnection,
  ExampleFlowElement,
  ExampleFlowNode,
} from '../moddle/examples/types';

export type BuildExamplesRegistryCommand = {
  type: 'build-examples-registry';
  moddle: any;
};

const RESERVED_EXAMPLE_KEYS = new Set([
  'type',
  'name',
  'keywords',
  'icon',
  'attributes',
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
  'attributes',
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

export function runBuildExamplesRegistry(
  command: BuildExamplesRegistryCommand,
): Example[] {
  const { moddle } = command;
  const packages: any[] = moddle.getPackages();
  const typeMap: Record<string, any> = moddle.registry.typeMap;
  const examplesOut: Example[] = [];

  for (const pkg of packages) {
    const examples: any[] = pkg.examples ?? [];
    const prefix: string = pkg.prefix;

    for (const [index, example] of examples.entries()) {
      const obj = example?.object;
      const exampleType = obj?.type;
      if (!exampleType) continue;

      const mixinData = resolveExampleMixins(moddle, obj, prefix);
      const mergedObject: Record<string, any> = {
        ...mixinData.properties,
        ...obj,
      };

      const typeName: string = mergedObject.type;
      const qualifiedName = typeName.includes(':') ? typeName : `${prefix}:${typeName}`;
      const typeDescriptor = typeMap[qualifiedName];
      if (!typeDescriptor) continue;
      if (typeDescriptor.isAbstract) continue;
      if (typeDescriptor.extends?.length && !typeDescriptor.meta?.exampleScopedType) continue;

      const bpmnType: string | undefined =
        mixinData.bpmnTypeOverride ?? typeDescriptor.meta?.bpmnType;
      if (!bpmnType) continue;

      const iconClass: string | undefined = mergedObject.icon ?? typeDescriptor.icon;
      const overrideIconClass: string | undefined = mergedObject.icon;
      const exampleProperties = extractProperties(mergedObject, RESERVED_EXAMPLE_KEYS);
      const flowElements = normalizeFlowElements(moddle, mergedObject, prefix, typeMap);

      const exampleName = mergedObject.name ?? mergedObject['bpmn:name'] ?? typeName;
      const exampleEntry: Example = {
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
        overrideIconClass,
        exampleProperties: Object.keys(exampleProperties).length > 0 ? exampleProperties : undefined,
        flowElements,
        templateSource: 'schema-example',
        schemaPrefix: prefix.toLowerCase(),
      };

      examplesOut.push(exampleEntry);
    }
  }

  return examplesOut;
}

function resolveTypeDescriptor(moddle: any, typeRef: string, prefix: string): any {
  const typeMap: Record<string, any> = moddle.registry.typeMap;
  const localName = typeRef.includes(':') ? typeRef.slice(typeRef.indexOf(':') + 1) : typeRef;
  const candidates = [typeRef, `${prefix}:${localName}`, localName];

  for (const candidate of candidates) {
    if (typeMap[candidate]) {
      return typeMap[candidate];
    }
  }

  try {
    return moddle.getTypeDescriptor(typeRef);
  } catch {
    return undefined;
  }
}

function getDefaultProperties(typeDescriptor: any): Record<string, any> {
  const defaults: Record<string, any> = {};

  for (const property of typeDescriptor?.properties ?? []) {
    if (property.default !== undefined) {
      defaults[property.name] = property.default;
    }
  }

  return defaults;
}

function resolveExampleMixins(
  moddle: any,
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

    const descriptor = resolveTypeDescriptor(moddle, mixinRef, prefix);
    if (!descriptor) {
      console.warn(`[examples-loader] Unable to resolve mixin '${mixinRef}'`);
      continue;
    }

    Object.assign(properties, getDefaultProperties(descriptor));

    if (mixinRef.startsWith('bpmn:')) {
      bpmnTypeOverride = mixinRef;
    }
  }

  return { bpmnTypeOverride, properties };
}

function extractProperties(
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

function resolveSchemaTypeDescriptor(
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

function normalizeFlowNode(
  moddle: any,
  entry: Record<string, any>,
  prefix: string,
  typeMap: Record<string, any>,
): ExampleFlowNode | null {
  const entryType = entry?.type;
  if (typeof entryType !== 'string' || entryType.trim() === '') {
    return null;
  }

  const mixinData = resolveExampleMixins(moddle, entry, prefix);
  const mergedEntry: Record<string, any> = {
    ...mixinData.properties,
    ...entry,
  };

  let studyflowType: string | undefined;
  let bpmnType: string | undefined;
  let typeDescriptor: any;

  if (mergedEntry.type.startsWith('bpmn:')) {
    typeDescriptor = resolveTypeDescriptor(moddle, mergedEntry.type, prefix);
    bpmnType = mixinData.bpmnTypeOverride ?? mergedEntry.type;
  } else {
    const resolved = resolveSchemaTypeDescriptor(mergedEntry.type, prefix, typeMap);
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
    overrideIconClass: mergedEntry.icon,
    exampleProperties: extractProperties(mergedEntry, RESERVED_FLOW_NODE_KEYS),
    x: typeof mergedEntry.x === 'number' ? mergedEntry.x : undefined,
    y: typeof mergedEntry.y === 'number' ? mergedEntry.y : undefined,
  };
}

function normalizeFlowConnection(
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
    exampleProperties: extractProperties(entry, RESERVED_FLOW_CONNECTION_KEYS),
  };
}

function normalizeFlowElements(
  moddle: any,
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
      const connection = normalizeFlowConnection(entry);
      if (connection) {
        normalized.push(connection);
      }
      continue;
    }

    if (typeof entry.type === 'string') {
      const node = normalizeFlowNode(moddle, entry, prefix, typeMap);
      if (node) {
        normalized.push(node);
      }
    }
  }

  return normalized.length > 0 ? normalized : undefined;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}