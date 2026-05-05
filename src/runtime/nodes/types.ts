import { getProperty } from '@/modeler/extensions/resolve';
import type { LogKind } from '../styles';
import type { Job, FlowNode } from '../types';

export type NodeProps<J extends Job = Job> = {
  job: J;
  log: (kind: LogKind, message: string) => void;
  setVariable: (name: string, value: unknown) => void;
  complete: (result?: unknown) => void;
  abort: (reason: string) => void;
};

/**
 * Read a property off the BPMN business object, falling back to the
 * `$attrs` map (where bpmn-moddle stuffs unknown attributes from legacy
 * diagrams). Mirrors the pattern in nodes/behaverse/parser.ts so every
 * node's `*ToJob` reads properties the same way.
 */
export function readNamespacedProperty(
  businessObject: any,
  namespace: string,
  propertyName: string,
): string | undefined {
  const fromProperty = getProperty(businessObject, propertyName);
  if (typeof fromProperty === 'string' && fromProperty.length > 0) return fromProperty;

  const attrs = businessObject?.$attrs;
  if (attrs && typeof attrs === 'object') {
    const namespaced = attrs[`${namespace}:${propertyName}`];
    if (typeof namespaced === 'string' && namespaced.length > 0) return namespaced;
    const bare = attrs[propertyName];
    if (typeof bare === 'string' && bare.length > 0) return bare;
  }

  return typeof fromProperty === 'string' ? fromProperty : undefined;
}

export function readBoolProperty(businessObject: any, propertyName: string): boolean {
  const direct = getProperty(businessObject, propertyName);
  if (typeof direct === 'boolean') return direct;
  const raw = readNamespacedProperty(businessObject, 'studyflow', propertyName);
  return raw === 'true' || raw === '1';
}

export type { FlowNode };
