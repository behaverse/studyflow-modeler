import { BPMN } from '../../constants';
import type { Template } from '../../moddle/templates/types';
import { resolveBpmnCreateType } from '../../moddle/resolveBpmnType';
import { capitalize, extractProperties, resolveTemplateMixins } from './mixins';
import { normalizeFlowElements } from './normalizeFlow';

export type BuildTemplatesRegistryCommand = {
  type: 'build-templates-registry';
  moddle: any;
};

const RESERVED_TEMPLATE_KEYS = new Set([
  'type',
  'name',
  'keywords',
  'icon',
  'attributes',
  'mixins',
  'flowElements',
]);

/**
 * Build the full template registry: one `Template` per declared template in
 * each moddle package, plus implicit templates derived from any type that
 * declares `meta.flowElements` (subprocess shorthand).
 */
export function runBuildTemplatesRegistry(
  command: BuildTemplatesRegistryCommand,
): Template[] {
  const { moddle } = command;
  const packages: any[] = moddle.getPackages();
  const typeMap: Record<string, any> = moddle.registry.typeMap;
  const templatesOut: Template[] = [];

  for (const pkg of packages) {
    const templates: any[] = pkg.templates ?? [];
    const prefix: string = pkg.prefix;

    for (const [index, template] of templates.entries()) {
      const obj = template?.object;
      const templateType = obj?.type;
      if (!templateType) continue;

      const mixinData = resolveTemplateMixins(moddle, obj, prefix);
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
      const templateProperties = extractProperties(mergedObject, RESERVED_TEMPLATE_KEYS);
      const flowElements = normalizeFlowElements(moddle, mergedObject, prefix, typeMap);

      const templateName = mergedObject.name ?? mergedObject['bpmn:name'] ?? typeName;
      const templateEntry: Template = {
        id: `${qualifiedName}::template:${index + 1}`,
        name: templateName,
        description: template.description ?? typeDescriptor.description ?? '',
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
        templateProperties: Object.keys(templateProperties).length > 0 ? templateProperties : undefined,
        flowElements,
        templateSource: 'schema-template',
        schemaPrefix: prefix.toLowerCase(),
      };

      templatesOut.push(templateEntry);
    }
  }

  templatesOut.push(...buildImplicitTemplatesFromTypes(moddle, packages, typeMap));

  return templatesOut;
}

function buildImplicitTemplatesFromTypes(
  moddle: any,
  packages: any[],
  typeMap: Record<string, any>,
): Template[] {
  const out: Template[] = [];

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

      // Declaring meta.flowElements implies subprocess intent - always use bpmn:SubProcess.
      const bpmnType = BPMN.SubProcess;

      const syntheticObj: Record<string, any> = { flowElements };
      const normalized = normalizeFlowElements(moddle, syntheticObj, prefix, typeMap);

      const iconClass: string | undefined = type.meta?.icon ?? type.icon;

      const entry: Template = {
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
        templateProperties: undefined,
        flowElements: normalized,
        templateSource: 'schema-type',
        schemaPrefix: prefix.toLowerCase(),
      };

      out.push(entry);
    }
  }

  return out;
}
