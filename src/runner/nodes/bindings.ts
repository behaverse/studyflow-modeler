import * as yaml from 'js-yaml';

import { getAttribute } from '@/lib/core/extensions';
import { KNOWN_SCHEMES, parseUses, type ParsedUses } from '@/lib/core/bindings';
import type { FlowNode } from '@/lib/core/flow';
import type { Studyflow } from '@/runner/studyflow';
import type { ValidationIssue } from './types';
import { readString } from './readAttribute';

/** The executable binding declared on an activity, if any. */
export type Binding = {
  uses: string;
  withYaml?: string;
};

/** Read a `uses`/`with` binding off a node; undefined when no `uses` is set. */
export function readBinding(node: FlowNode): Binding | undefined {
  const uses = readString(node, 'uses');
  if (!uses) return undefined;
  const withValue = getAttribute(node.businessObject, 'with');
  const withYaml = typeof withValue === 'string' && withValue.trim() ? withValue : undefined;
  return { uses, withYaml };
}

/** Parsed view of a binding, for display: the reference breakdown plus args. */
export type ResolvedBinding = {
  uses: string;
  parsed?: ParsedUses;
  knownScheme: boolean;
  args?: Record<string, unknown>;
};

export function resolveBinding(binding: Binding): ResolvedBinding {
  const result = parseUses(binding.uses);
  const parsed = result.ok ? result.value : undefined;
  let args: Record<string, unknown> | undefined;
  if (binding.withYaml) {
    try {
      const loaded = yaml.load(binding.withYaml);
      if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
        args = loaded as Record<string, unknown>;
      }
    } catch {
      args = undefined;
    }
  }
  return {
    uses: binding.uses,
    parsed,
    knownScheme: !!parsed && KNOWN_SCHEMES.includes(parsed.scheme),
    args,
  };
}

/** Validate every binding in the flow: the `uses` grammar and the `with` YAML. */
export function validateBindings(studyflow: Studyflow): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const node of studyflow.flowNodes.values()) {
    const binding = readBinding(node);
    if (!binding) continue;

    const result = parseUses(binding.uses);
    if (!result.ok) {
      issues.push({ nodeId: node.id, message: `Invalid 'uses' binding: ${result.error}` });
    } else if (!KNOWN_SCHEMES.includes(result.value.scheme)) {
      issues.push({
        nodeId: node.id,
        message: `Binding scheme '${result.value.scheme}://' is not one of ${KNOWN_SCHEMES.join(', ')}; the runner will not resolve it.`,
      });
    }

    if (binding.withYaml) {
      let loaded: unknown;
      try {
        loaded = yaml.load(binding.withYaml);
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
