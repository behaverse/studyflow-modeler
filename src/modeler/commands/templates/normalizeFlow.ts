import type {
  TemplateFlowConnection,
  TemplateFlowElement,
  TemplateFlowNode,
} from '../../moddle/templates/types';
import { resolveBpmnCreateType } from '../../moddle/resolveBpmnType';
import { extractAttributes, resolveTemplateMixins, resolveTypeSchema } from './mixins';
import { RESERVED_TEMPLATE_KEYS } from './reservedKeys';

const RESERVED_FLOW_NODE_KEYS = new Set([...RESERVED_TEMPLATE_KEYS, 'id', 'x', 'y']);

const RESERVED_FLOW_CONNECTION_KEYS = new Set([
  'id',
  'type',
  'bpmn:type',
  'sourceRef',
  'targetRef',
]);

function normalizeFlowNode(
  moddle: any,
  flowElement: Record<string, any>,
  prefix: string,
  typeMap: Record<string, any>,
): TemplateFlowNode | null {
  if (typeof flowElement?.type !== 'string' || flowElement.type.trim() === '') return null;

  const mixinData = resolveTemplateMixins(moddle, flowElement, prefix);
  const merged: Record<string, any> = { ...mixinData.attributes, ...flowElement };

  let extensionType: string | undefined;
  let bpmnType: string | undefined;
  let typeDef: any;

  if (merged.type.startsWith('bpmn:')) {
    typeDef = resolveTypeSchema(moddle, merged.type, prefix);
    bpmnType = mixinData.bpmnTypeOverride ?? merged.type;
  } else {
    const qualifiedName = merged.type.includes(':') ? merged.type : `${prefix}:${merged.type}`;
    typeDef = typeMap[qualifiedName];
    if (!typeDef || typeDef.isAbstract) return null;
    extensionType = qualifiedName;
    bpmnType = mixinData.bpmnTypeOverride ?? resolveBpmnCreateType(moddle, typeDef) ?? undefined;
  }

  if (!bpmnType) return null;

  return {
    id: String(merged.id),
    kind: 'node',
    extensionType,
    bpmnType,
    iconClass: merged.icon ?? typeDef?.icon,
    overrideIconClass: merged.icon,
    templateAttributes: extractAttributes(merged, RESERVED_FLOW_NODE_KEYS),
    x: typeof merged.x === 'number' ? merged.x : undefined,
    y: typeof merged.y === 'number' ? merged.y : undefined,
  };
}

function normalizeFlowConnection(
  flowElement: Record<string, any>,
): TemplateFlowConnection | null {
  const bpmnType = flowElement?.['bpmn:type'] ?? flowElement?.type;
  const sourceRef = flowElement?.sourceRef;
  const targetRef = flowElement?.targetRef;

  if (
    typeof bpmnType !== 'string'
    || typeof sourceRef !== 'string'
    || typeof targetRef !== 'string'
  ) {
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

/** Normalize a schema template's `flowElements` into tagged `TemplateFlowElement`s. */
export function normalizeFlowElements(
  moddle: any,
  definition: Record<string, any>,
  prefix: string,
  typeMap: Record<string, any>,
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
      : (typeof flowElement.type === 'string' ? normalizeFlowNode(moddle, flowElement, prefix, typeMap) : null);

    if (result) normalized.push(result);
  }

  return normalized.length > 0 ? normalized : undefined;
}
