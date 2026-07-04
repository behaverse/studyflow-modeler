/**
 * Template compilation (port of the former buildTemplatesRegistry/mixins/
 * normalizeFlow): turns each schema's `templates:` section — plus the
 * implicit SubProcess template of any type declaring `meta.flowElements` —
 * into the bpmn-js-create-append-anything contract. Runs after every schema
 * is registered because mixins and type refs resolve cross-schema.
 */

import type { TypeCatalog } from '@/core/catalog/compile';
import type { Template, TemplateFlowConnection, TemplateFlowElement, TemplateFlowNode } from '@/core/catalog/types';

// Template-definition metadata keys; stripped before attributes flow onto the canvas.
const RESERVED_TEMPLATE_KEYS = new Set(['type', 'name', 'keywords', 'icon', 'attributes', 'mixins', 'flowElements']);
const RESERVED_FLOW_NODE_KEYS = new Set([...RESERVED_TEMPLATE_KEYS, 'id', 'x', 'y']);
const RESERVED_FLOW_CONNECTION_KEYS = new Set(['id', 'type', 'bpmn:type', 'sourceRef', 'targetRef']);

type RawType = Record<string, any>;

export function compileTemplates(prefix: string, rawSchema: RawType, catalog: TypeCatalog): Template[] {
  const templates: Template[] = [];
  const schemaTemplates: RawType[] = rawSchema?.templates ?? [];

  for (const [index, template] of schemaTemplates.entries()) {
    const definition = template?.object;
    if (!definition?.type) continue;

    const mixinData = resolveTemplateMixins(definition, prefix, catalog);
    const merged: Record<string, any> = { ...mixinData.attributes, ...definition };

    const typeName: string = merged.type;
    const qualifiedName = typeName.includes(':') ? typeName : `${prefix}:${typeName}`;
    const entry = catalog.getType(qualifiedName);
    if (!entry || entry.isAbstract) continue;

    const bpmnType = mixinData.bpmnTypeOverride ?? entry.bpmnType;
    if (!bpmnType) continue;

    const attrs = extractAttributes(merged, RESERVED_TEMPLATE_KEYS);

    templates.push({
      id: `${qualifiedName}::template:${index + 1}`,
      name: merged.name ?? merged['bpmn:name'] ?? typeName,
      description: template.description ?? entry.description ?? '',
      appliesTo: [bpmnType],
      elementType: { value: bpmnType },
      category: { id: prefix, name: capitalize(prefix) },
      keywords: merged.keywords ?? [],
      extensionType: qualifiedName,
      bpmnType,
      iconClass: merged.icon ?? entry.icon,
      overrideIconClass: merged.icon,
      templateAttributes: Object.keys(attrs).length > 0 ? attrs : undefined,
      flowElements: normalizeFlowElements(merged, prefix, catalog),
      templateSource: 'schema-template',
      schemaPrefix: prefix.toLowerCase(),
    });
  }

  // Implicit SubProcess template for any type declaring `meta.flowElements`.
  for (const entry of catalog.schemaFor(prefix)?.types ?? []) {
    if (entry.isAbstract) continue;
    const flowElements: Array<Record<string, any>> | undefined = entry.meta?.flowElements;
    if (!flowElements?.length) continue;

    templates.push({
      id: `${entry.name}::type-default`,
      name: entry.ns.localName,
      description: entry.description ?? '',
      appliesTo: ['bpmn:SubProcess'],
      elementType: { value: 'bpmn:SubProcess' },
      category: { id: prefix, name: capitalize(prefix) },
      keywords: [],
      extensionType: entry.name,
      bpmnType: 'bpmn:SubProcess',
      iconClass: entry.meta?.icon ?? entry.icon,
      overrideIconClass: undefined,
      templateAttributes: undefined,
      flowElements: normalizeFlowElements({ flowElements }, prefix, catalog),
      templateSource: 'schema-type',
      schemaPrefix: prefix.toLowerCase(),
    });
  }

  return templates;
}

/** Resolve a `mixins:` chain; each contributes defaults, `bpmn:*` mixins override the BPMN type. */
function resolveTemplateMixins(
  definition: Record<string, any>,
  prefix: string,
  catalog: TypeCatalog,
): { bpmnTypeOverride?: string; attributes: Record<string, any> } {
  const mixins = Array.isArray(definition.mixins) ? definition.mixins : [];
  const attrs: Record<string, any> = {};
  let bpmnTypeOverride: string | undefined;

  for (const mixinRef of mixins) {
    if (typeof mixinRef !== 'string' || mixinRef.trim() === '') continue;

    if (mixinRef.startsWith('bpmn:')) {
      bpmnTypeOverride = mixinRef;
      continue;
    }

    const entry = catalog.getType(mixinRef, prefix);
    if (!entry) {
      console.warn(`[catalog] Unable to resolve template mixin '${mixinRef}'`);
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
): TemplateFlowElement[] | undefined {
  if (!Array.isArray(definition.flowElements) || definition.flowElements.length === 0) return undefined;

  const normalized: TemplateFlowElement[] = [];

  for (const flowElement of definition.flowElements) {
    if (!flowElement || typeof flowElement !== 'object') continue;

    const isConnection =
      typeof flowElement.sourceRef === 'string'
      && typeof flowElement.targetRef === 'string'
      && (typeof flowElement.type === 'string' || typeof flowElement['bpmn:type'] === 'string');

    const result = isConnection
      ? normalizeFlowConnection(flowElement)
      : (typeof flowElement.type === 'string' ? normalizeFlowNode(flowElement, prefix, catalog) : null);

    if (result) normalized.push(result);
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeFlowNode(
  flowElement: Record<string, any>,
  prefix: string,
  catalog: TypeCatalog,
): TemplateFlowNode | null {
  if (typeof flowElement?.type !== 'string' || flowElement.type.trim() === '') return null;

  const mixinData = resolveTemplateMixins(flowElement, prefix, catalog);
  const merged: Record<string, any> = { ...mixinData.attributes, ...flowElement };

  let extensionType: string | undefined;
  let bpmnType: string | undefined;
  let icon: string | undefined;

  if (merged.type.startsWith('bpmn:')) {
    bpmnType = mixinData.bpmnTypeOverride ?? merged.type;
  } else {
    const qualifiedName = merged.type.includes(':') ? merged.type : `${prefix}:${merged.type}`;
    const entry = catalog.getType(qualifiedName);
    if (!entry || entry.isAbstract) return null;
    extensionType = qualifiedName;
    bpmnType = mixinData.bpmnTypeOverride ?? entry.bpmnType ?? undefined;
    icon = entry.icon;
  }

  if (!bpmnType) return null;

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

function normalizeFlowConnection(flowElement: Record<string, any>): TemplateFlowConnection | null {
  const bpmnType = flowElement?.['bpmn:type'] ?? flowElement?.type;
  const sourceRef = flowElement?.sourceRef;
  const targetRef = flowElement?.targetRef;

  if (typeof bpmnType !== 'string' || typeof sourceRef !== 'string' || typeof targetRef !== 'string') {
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

/** Keep only keys not in `reservedKeys`, dropping `undefined` values. */
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
