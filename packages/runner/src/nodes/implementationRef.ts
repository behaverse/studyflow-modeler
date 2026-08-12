import * as yaml from 'js-yaml';

import { getAttribute } from '@core/element';
import { KNOWN_SCHEMES, parseImplementationRef, type ImplementationRef } from '@core/implementation';
import { readString, type FlowNode } from '@runner/flow';
import type { Studyflow } from '@runner/studyflow';
import type { ValidationIssue } from '@runner/nodes/types';

/** BPMN's `implementation` attribute plus the node's `additionalArguments` YAML body. */
export type Implementation = {
  ref: string;
  argsYaml?: string;
};

export function readImplementation(node: FlowNode): Implementation | undefined {
  const ref = readString(node, 'implementation');
  if (!ref) return undefined;
  const withValue = getAttribute(node.businessObject, 'additionalArguments');
  const argsYaml = typeof withValue === 'string' && withValue.trim() ? withValue : undefined;
  return { ref, argsYaml };
}

export type ResolvedImplementation = {
  parsed?: ImplementationRef;
  args?: Record<string, unknown>;
};

export function resolveImplementation(implementation: Implementation): ResolvedImplementation {
  const result = parseImplementationRef(implementation.ref);
  const parsed = result.ok ? result.value : undefined;
  let args: Record<string, unknown> | undefined;
  if (implementation.argsYaml) {
    try {
      const loaded = yaml.load(implementation.argsYaml);
      if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
        args = loaded as Record<string, unknown>;
      }
    } catch {
      args = undefined;
    }
  }
  return { parsed, args };
}

export function validateImplementations(studyflow: Studyflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const node of studyflow.flowNodes.values()) {
    const implementation = readImplementation(node);
    if (!implementation) continue;

    const result = parseImplementationRef(implementation.ref);
    if (!result.ok) {
      issues.push({ nodeId: node.id, message: `Invalid 'implementation' function reference: ${result.error}` });
    } else if (!KNOWN_SCHEMES.includes(result.value.scheme)) {
      issues.push({
        nodeId: node.id,
        severity: 'warning',
        message: `Function scheme '${result.value.scheme}://' is not one of ${KNOWN_SCHEMES.join(', ')}; the runner will not resolve it.`,
      });
    }

    if (implementation.argsYaml) {
      let loaded: unknown;
      try {
        loaded = yaml.load(implementation.argsYaml);
      } catch (err) {
        issues.push({ nodeId: node.id, message: `Invalid 'additionalArguments' YAML: ${(err as Error).message}` });
        continue;
      }
      if (loaded == null || typeof loaded !== 'object' || Array.isArray(loaded)) {
        issues.push({ nodeId: node.id, message: "'additionalArguments' must be a YAML mapping of argument names to values." });
      }
    }
  }

  return issues;
}
