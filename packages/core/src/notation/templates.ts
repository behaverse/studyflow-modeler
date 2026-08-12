import type { TypeCatalog } from '@core/notation/query';
import type { SchemaModel, SchemaTemplateModel } from '@core/notation/schemaFile';
import type { Template, TemplateFlowConnection, TemplateFlowElement, TemplateFlowNode } from '@core/notation/types';

// Metadata keys, stripped before the rest flows onto the canvas as attributes.
const RESERVED_TEMPLATE_KEYS = new Set(['type', 'name', 'keywords', 'icon', 'mixins', 'flowElements']);
const RESERVED_FLOW_NODE_KEYS = new Set([...RESERVED_TEMPLATE_KEYS, 'id', 'x', 'y']);
const RESERVED_FLOW_CONNECTION_KEYS = new Set(['id', 'type', 'bpmn:type', 'sourceRef', 'targetRef']);

function warn(catalog: TypeCatalog, prefix: string, where: string, message: string): void {
  catalog.diagnostics.push(`[${prefix} ${where}] ${message}`);
}

export function compileTemplates(prefix: string, model: SchemaModel, catalog: TypeCatalog): Template[] {
  const templates: Template[] = [];
  const schemaTemplates: SchemaTemplateModel[] = model?.templates ?? [];

  for (const [index, template] of schemaTemplates.entries()) {
    const where = `template:${index + 1}`;
    const definition = template?.object;
    if (!definition?.type) {
      warn(catalog, prefix, where, 'template has no `object.type`; skipped');
      continue;
    }

    const mixinData = resolveTemplateMixins(definition, prefix, catalog, where);
    const merged: Record<string, any> = { ...mixinData.attributes, ...definition };

    const typeName: string = merged.type;
    const qualifiedName = typeName.includes(':') ? typeName : `${prefix}:${typeName}`;
    const isBpmnRoot = typeName.startsWith('bpmn:');
    const entry = isBpmnRoot ? undefined : catalog.getType(qualifiedName);
    if (!isBpmnRoot && !entry) {
      warn(catalog, prefix, where, `roots at unknown type '${typeName}'; skipped`);
      continue;
    }
    if (entry?.isAbstract) {
      warn(catalog, prefix, where, `roots at abstract type '${qualifiedName}'; skipped`);
      continue;
    }

    const bpmnType = mixinData.bpmnTypeOverride ?? (isBpmnRoot ? typeName : entry!.bpmnType);
    if (!bpmnType) {
      warn(catalog, prefix, where, `root type '${qualifiedName}' has no BPMN attach point; skipped`);
      continue;
    }

    const attrs = extractAttributes(merged, RESERVED_TEMPLATE_KEYS);

    templates.push({
      // Scoped by the *defining* prefix: root type + index collides across schemas, and `palette-start-create-template` resolves ids by first match.
      id: `${prefix}::${qualifiedName}::template:${index + 1}`,
      name: merged.name ?? merged['bpmn:name'] ?? typeName,
      description: template.description ?? entry?.description ?? '',
      appliesTo: [bpmnType],
      elementType: { value: bpmnType },
      category: { id: prefix, name: capitalize(prefix) },
      keywords: merged.keywords ?? [],
      extensionType: isBpmnRoot ? undefined : qualifiedName,
      bpmnType,
      iconClass: merged.icon ?? entry?.iconClass,
      overrideIconClass: merged.icon,
      templateAttributes: Object.keys(attrs).length > 0 ? attrs : undefined,
      flowElements: normalizeFlowElements(merged, prefix, catalog, where),
      templateSource: 'schema-template',
      schemaPrefix: prefix.toLowerCase(),
    });
  }

  return templates;
}

function resolveTemplateMixins(
  definition: Record<string, any>,
  prefix: string,
  catalog: TypeCatalog,
  where: string,
): { bpmnTypeOverride?: string; attributes: Record<string, any> } {
  const mixins = Array.isArray(definition.mixins) ? definition.mixins : [];
  const attrs: Record<string, any> = {};
  let bpmnTypeOverride: string | undefined;

  for (const mixinRef of mixins) {
    if (typeof mixinRef !== 'string' || mixinRef.trim() === '') {
      warn(catalog, prefix, where, `ignored malformed mixin ${JSON.stringify(mixinRef)}`);
      continue;
    }

    if (mixinRef.startsWith('bpmn:')) {
      bpmnTypeOverride = mixinRef;
      continue;
    }

    const entry = catalog.getType(mixinRef, prefix);
    if (!entry) {
      warn(catalog, prefix, where, `unresolved mixin '${mixinRef}'; its defaults are missing`);
      continue;
    }
    Object.assign(attrs, entry.defaults);
  }

  return { bpmnTypeOverride, attributes: attrs };
}

function normalizeFlowElements(
  definition: Record<string, any>,
  prefix: string,
  catalog: TypeCatalog,
  where: string,
): TemplateFlowElement[] | undefined {
  if (!Array.isArray(definition.flowElements) || definition.flowElements.length === 0) return undefined;

  const normalized: TemplateFlowElement[] = [];

  for (const [index, flowElement] of definition.flowElements.entries()) {
    const at = `${where} flowElements[${index}]`;
    if (!flowElement || typeof flowElement !== 'object') {
      warn(catalog, prefix, at, 'flow element is not an object; skipped');
      continue;
    }

    const isConnection =
      typeof flowElement.sourceRef === 'string'
      && typeof flowElement.targetRef === 'string'
      && (typeof flowElement.type === 'string' || typeof flowElement['bpmn:type'] === 'string');

    if (!isConnection && typeof flowElement.type !== 'string') {
      warn(catalog, prefix, at, 'flow element declares neither a `type` nor a source/target pair; skipped');
      continue;
    }

    const result = isConnection
      ? normalizeFlowConnection(flowElement, catalog, prefix, at)
      : normalizeFlowNode(flowElement, prefix, catalog, at);

    if (result) normalized.push(result);
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeFlowNode(
  flowElement: Record<string, any>,
  prefix: string,
  catalog: TypeCatalog,
  where: string,
): TemplateFlowNode | null {
  if (typeof flowElement?.type !== 'string' || flowElement.type.trim() === '') {
    warn(catalog, prefix, where, 'flow node has an empty `type`; skipped');
    return null;
  }

  const mixinData = resolveTemplateMixins(flowElement, prefix, catalog, where);
  const merged: Record<string, any> = { ...mixinData.attributes, ...flowElement };

  let extensionType: string | undefined;
  let bpmnType: string | undefined;
  let icon: string | undefined;

  if (merged.type.startsWith('bpmn:')) {
    bpmnType = mixinData.bpmnTypeOverride ?? merged.type;
  } else {
    const qualifiedName = merged.type.includes(':') ? merged.type : `${prefix}:${merged.type}`;
    const entry = catalog.getType(qualifiedName);
    if (!entry) {
      warn(catalog, prefix, where, `flow node has unknown type '${merged.type}'; skipped`);
      return null;
    }
    if (entry.isAbstract) {
      warn(catalog, prefix, where, `flow node has abstract type '${qualifiedName}'; skipped`);
      return null;
    }
    extensionType = qualifiedName;
    bpmnType = mixinData.bpmnTypeOverride ?? entry.bpmnType ?? undefined;
    icon = entry.iconClass;
  }

  if (!bpmnType) {
    warn(catalog, prefix, where, `flow node type '${merged.type}' has no BPMN attach point; skipped`);
    return null;
  }

  return {
    id: String(merged.id),
    kind: 'node',
    extensionType,
    bpmnType,
    iconClass: merged.icon ?? icon,
    overrideIconClass: merged.icon,
    templateAttributes: extractAttributes(merged, RESERVED_FLOW_NODE_KEYS),
    x: typeof merged.x === 'number' ? merged.x : undefined,
    y: typeof merged.y === 'number' ? merged.y : undefined,
  };
}

function normalizeFlowConnection(
  flowElement: Record<string, any>,
  catalog: TypeCatalog,
  prefix: string,
  where: string,
): TemplateFlowConnection | null {
  const bpmnType = flowElement?.['bpmn:type'] ?? flowElement?.type;
  const sourceRef = flowElement?.sourceRef;
  const targetRef = flowElement?.targetRef;

  if (typeof bpmnType !== 'string' || typeof sourceRef !== 'string' || typeof targetRef !== 'string') {
    warn(catalog, prefix, where, 'flow connection needs string `type`, `sourceRef` and `targetRef`; skipped');
    return null;
  }

  return {
    id: typeof flowElement.id === 'string' ? flowElement.id : undefined,
    kind: 'connection',
    bpmnType,
    sourceRef,
    targetRef,
    templateAttributes: extractAttributes(flowElement, RESERVED_FLOW_CONNECTION_KEYS),
  };
}

function extractAttributes(definition: Record<string, any>, reservedKeys: Set<string>): Record<string, any> {
  const attributes: Record<string, any> = {};
  for (const [key, value] of Object.entries(definition)) {
    if (!reservedKeys.has(key) && value !== undefined) attributes[key] = value;
  }
  return attributes;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
