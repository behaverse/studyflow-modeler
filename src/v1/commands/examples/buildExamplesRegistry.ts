import { BPMN } from '../../constants/bpmn';
import type { Example } from '../../moddle/examples/types';
import { resolveBpmnCreateType } from '../../moddle/resolveBpmnType';
import { capitalize, extractProperties, resolveExampleMixins } from './mixins';
import { normalizeFlowElements } from './normalizeFlow';

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

/**
 * Build the full example registry: one `Example` per declared example in
 * each moddle package, plus implicit examples derived from any type that
 * declares `meta.flowElements` (subprocess shorthand).
 */
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

      const bpmnType: string | undefined =
        mixinData.bpmnTypeOverride ?? resolveBpmnCreateType(moddle, typeDescriptor) ?? undefined;
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

  examplesOut.push(...buildImplicitExamplesFromTypes(moddle, packages, typeMap));

  return examplesOut;
}

function buildImplicitExamplesFromTypes(
  moddle: any,
  packages: any[],
  typeMap: Record<string, any>,
): Example[] {
  const out: Example[] = [];

  for (const pkg of packages) {
    const prefix: string = pkg.prefix;
    const types: any[] = pkg.types ?? [];

    for (const type of types) {
      if (type.isAbstract) continue;

      const flowElements: Array<Record<string, any>> | undefined = type.meta?.flowElements;
      if (!Array.isArray(flowElements) || flowElements.length === 0) continue;

      const qualifiedName = `${prefix}:${type.name}`;
      const typeDescriptor = typeMap[qualifiedName];
      if (!typeDescriptor) continue;

      // Declaring meta.flowElements implies subprocess intent — always use bpmn:SubProcess.
      const bpmnType = BPMN.SubProcess;

      const syntheticObj: Record<string, any> = { flowElements };
      const normalized = normalizeFlowElements(moddle, syntheticObj, prefix, typeMap);

      const iconClass: string | undefined = type.meta?.icon ?? type.icon;

      const entry: Example = {
        id: `${qualifiedName}::type-default`,
        name: type.name,
        description: type.description ?? '',
        appliesTo: [bpmnType],
        elementType: { value: bpmnType },
        category: {
          id: prefix,
          name: capitalize(prefix),
        },
        keywords: [],
        studyflowType: qualifiedName,
        bpmnType,
        iconClass,
        overrideIconClass: undefined,
        exampleProperties: undefined,
        flowElements: normalized,
        templateSource: 'schema-type',
        schemaPrefix: prefix.toLowerCase(),
      };

      out.push(entry);
    }
  }

  return out;
}
