/**
 * Debug: walk the flow without mounting the heavy screens.
 *
 * `?debug=1` stands a name card in for every node whose definition sets
 * `heavy` — the Behaverse task, which boots a Unity build, and the
 * questionnaire, which renders a full instrument. Everything cheap keeps
 * running for real: start and end events, instructions, gateways, timers and
 * the allocation draw, so the path through the study is the true one and only
 * the long screens are stood in for.
 */
import { readString, type FlowNode } from '@runner/flow';

const TRUTHY = new Set(['1', 'true', 'yes', 'on', '']);

export function isDebug(search: string = window.location.search): boolean {
  const params = new URLSearchParams(search);
  const value = params.get('debug');
  return value !== null && TRUTHY.has(value.toLowerCase());
}

/** What debug shows instead of the screen: enough to tell which step this is. */
export type DebugCard = {
  name: string;
  kind: string;
  details: Record<string, string>;
};

export function describeForDebug(node: FlowNode, kind: string): DebugCard {
  const details: Record<string, string> = { id: node.id };
  for (const key of ['instrument', 'timeline', 'platform']) {
    const value = readString(node, key);
    if (value) details[key] = value;
  }
  return { name: readString(node, 'name') || node.id, kind, details };
}
