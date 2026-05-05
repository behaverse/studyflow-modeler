import type { ComponentType } from 'react';
import { getProperty } from '@/modeler/extensions/resolve';
import type { LogKind } from '../styles';
import type { Job, FlowNode, Process } from '../types';
import type { Manifest, ValidationIssue } from './behaverse/types';

export type NodeProps<J extends Job = Job> = {
  job: J;
  log: (kind: LogKind, message: string) => void;
  setVariable: (name: string, value: unknown) => void;
  complete: (result?: unknown) => void;
  abort: (reason: string) => void;
};

/**
 * How a NodeDefinition recognizes a FlowNode. Match precedence in the registry
 * is appliedType → bpmnType → fallback, so fallback only catches bpmn:*Task
 * nodes that no other definition has claimed.
 */
export type NodeMatcher =
  | { appliedType: string }
  | { bpmnType: string | string[] }
  | { fallback: 'task' };

/**
 * Single source of truth for a runtime node kind. Each node module exports one
 * of these; the registry in nodes/index.ts collects them and drives all
 * dispatch (graph traversal, rendering, validation).
 */
export interface NodeDefinition<J extends { kind: string; node: FlowNode } = { kind: string; node: FlowNode }> {
  kind: J['kind'];
  match: NodeMatcher;
  toJob: (node: FlowNode) => J | null;
  Component: ComponentType<NodeProps<J>>;
  validate?: (process: Process, manifest?: Manifest) => ValidationIssue[];
}

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
