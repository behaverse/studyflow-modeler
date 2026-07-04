import * as yaml from 'js-yaml';

import { getAttribute } from '@/core/extensions';
import { KNOWN_SCHEMES, parseFunctionRef, type FunctionRef } from '@/core/functionRef';
import type { FlowNode } from '@/runner/models/flow';
import type { Studyflow } from '@/runner/models/studyflow';
import type { ValidationIssue } from '@/runner/models/nodes/types';
import { readString } from '@/runner/models/nodes/readAttribute';

/** The function call declared on an activity (`uses` + `with`), if any. */
export type FunctionCall = {
  functionRef: string;
  argsYaml?: string;
};

/** Read the `uses`/`with` pair off a node; undefined when no `uses` is set. */
export function readFunctionCall(node: FlowNode): FunctionCall | undefined {
  const functionRef = readString(node, 'uses');
  if (!functionRef) return undefined;
  const withValue = getAttribute(node.businessObject, 'with');
  const argsYaml = typeof withValue === 'string' && withValue.trim() ? withValue : undefined;
  return { functionRef, argsYaml };
}

/** Parsed view of a function call, for display: the reference breakdown plus arguments. */
export type ResolvedFunctionCall = {
  functionRef: string;
  parsed?: FunctionRef;
  knownScheme: boolean;
  args?: Record<string, unknown>;
};

export function resolveFunctionCall(call: FunctionCall): ResolvedFunctionCall {
  const result = parseFunctionRef(call.functionRef);
  const parsed = result.ok ? result.value : undefined;
  let args: Record<string, unknown> | undefined;
  if (call.argsYaml) {
    try {
      const loaded = yaml.load(call.argsYaml);
      if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
        args = loaded as Record<string, unknown>;
      }
    } catch {
      args = undefined;
    }
  }
  return {
    functionRef: call.functionRef,
    parsed,
    knownScheme: !!parsed && KNOWN_SCHEMES.includes(parsed.scheme),
    args,
  };
}

/** Validate every function call in the flow: the `uses` grammar and the `with` YAML. */
export function validateFunctionCalls(studyflow: Studyflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const node of studyflow.flowNodes.values()) {
    const call = readFunctionCall(node);
    if (!call) continue;

    const result = parseFunctionRef(call.functionRef);
    if (!result.ok) {
      issues.push({ nodeId: node.id, message: `Invalid 'uses' function reference: ${result.error}` });
    } else if (!KNOWN_SCHEMES.includes(result.value.scheme)) {
      issues.push({
        nodeId: node.id,
        message: `Function scheme '${result.value.scheme}://' is not one of ${KNOWN_SCHEMES.join(', ')}; the runner will not resolve it.`,
      });
    }

    if (call.argsYaml) {
      let loaded: unknown;
      try {
        loaded = yaml.load(call.argsYaml);
      } catch (err) {
        issues.push({ nodeId: node.id, message: `Invalid 'with' YAML: ${(err as Error).message}` });
        continue;
      }
      if (loaded == null || typeof loaded !== 'object' || Array.isArray(loaded)) {
        issues.push({ nodeId: node.id, message: "'with' must be a YAML mapping of argument names to values." });
      }
    }
  }

  return issues;
}
