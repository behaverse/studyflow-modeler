import type {
  ExampleFlowConnection,
  ExampleFlowElement,
  ExampleFlowNode,
} from '../../moddle/examples/types';
import { resolveBpmnCreateType } from '../../moddle/resolveBpmnType';
import { extractProperties, resolveExampleMixins, resolveTypeDescriptor } from './mixins';

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

  if (typeDescriptor.isAbstract) {
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
    bpmnType = mixinData.bpmnTypeOverride ?? resolveBpmnCreateType(moddle, resolved.typeDescriptor) ?? undefined;
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

/**
 * Normalize `obj.flowElements` — a loose mix of nodes and connections as
 * declared in a schema example — into a tagged union of
 * `ExampleFlowElement`s ready for the canvas.
 */
export function normalizeFlowElements(
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
