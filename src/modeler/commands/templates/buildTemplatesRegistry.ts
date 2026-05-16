import { BPMN } from '../../constants';
import type { Template } from '../../moddle/templates/types';
import { resolveBpmnCreateType } from '../../moddle/resolveBpmnType';
import { capitalize, extractAttributes, resolveTemplateMixins } from './mixins';
import { normalizeFlowElements } from './normalizeFlow';
import { RESERVED_TEMPLATE_KEYS } from './reservedKeys';

type BuildTemplatesRegistryCommand = {
  type: 'build-templates-registry';
  moddle: any;
};

/** Build templates from each package's `templates` plus implicit subprocess templates from `meta.flowElements`. */
export function runBuildTemplatesRegistry(
  command: BuildTemplatesRegistryCommand,
): Template[] {
  const { moddle } = command;
  const packages: any[] = moddle.getPackages();
  const typeMap: Record<string, any> = moddle.registry.typeMap;
  const templates: Template[] = [];

  for (const pkg of packages) {
    const pkgTemplates: any[] = pkg.templates ?? [];
    const prefix: string = pkg.prefix;

    for (const [index, template] of pkgTemplates.entries()) {
      const definition = template?.object;
      if (!definition?.type) continue;

      const mixinData = resolveTemplateMixins(moddle, definition, prefix);
      const merged: Record<string, any> = { ...mixinData.attributes, ...definition };

      const typeName: string = merged.type;
      const qualifiedName = typeName.includes(':') ? typeName : `${prefix}:${typeName}`;
      const typeDef = typeMap[qualifiedName];
      if (!typeDef || typeDef.isAbstract) continue;

      const bpmnType = mixinData.bpmnTypeOverride ?? resolveBpmnCreateType(moddle, typeDef);
      if (!bpmnType) continue;

      const attrs = extractAttributes(merged, RESERVED_TEMPLATE_KEYS);

      templates.push({
        id: `${qualifiedName}::template:${index + 1}`,
        name: merged.name ?? merged['bpmn:name'] ?? typeName,
        description: template.description ?? typeDef.description ?? '',
        appliesTo: [bpmnType],
        elementType: { value: bpmnType },
        category: { id: prefix, name: capitalize(prefix) },
        keywords: merged.keywords ?? [],
        extensionType: qualifiedName,
        bpmnType,
        iconClass: merged.icon ?? typeDef.icon,
        overrideIconClass: merged.icon,
        templateAttributes: Object.keys(attrs).length > 0 ? attrs : undefined,
        flowElements: normalizeFlowElements(moddle, merged, prefix, typeMap),
        templateSource: 'schema-template',
        schemaPrefix: prefix.toLowerCase(),
      });
    }
  }

  templates.push(...buildImplicitTemplatesFromTypes(moddle, packages, typeMap));

  return templates;
}

/** Synthesize a SubProcess template for any type declaring `meta.flowElements`. */
function buildImplicitTemplatesFromTypes(
  moddle: any,
  packages: any[],
  typeMap: Record<string, any>,
): Template[] {
  const templates: Template[] = [];

  for (const pkg of packages) {
    const prefix: string = pkg.prefix;
    for (const typeDef of pkg.types ?? []) {
      if (typeDef.isAbstract) continue;
      const flowElements: Array<Record<string, any>> | undefined = typeDef.meta?.flowElements;
      if (!flowElements?.length) continue;

      const qualifiedName = `${prefix}:${typeDef.name}`;
      if (!typeMap[qualifiedName]) continue;

      templates.push({
        id: `${qualifiedName}::type-default`,
        name: typeDef.name,
        description: typeDef.description ?? '',
        appliesTo: [BPMN.SubProcess],
        elementType: { value: BPMN.SubProcess },
        category: { id: prefix, name: capitalize(prefix) },
        keywords: [],
        extensionType: qualifiedName,
        bpmnType: BPMN.SubProcess,
        iconClass: typeDef.meta?.icon ?? typeDef.icon,
        overrideIconClass: undefined,
        templateAttributes: undefined,
        flowElements: normalizeFlowElements(moddle, { flowElements }, prefix, typeMap),
        templateSource: 'schema-type',
        schemaPrefix: prefix.toLowerCase(),
      });
    }
  }

  return templates;
}
