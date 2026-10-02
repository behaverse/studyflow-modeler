import { BPMN } from '@core/constants';
import { parseImplementationRef } from '@core/implementation';
import { isElement } from '@core/model/index';
import { readString, type FlowNode } from '@runner/flow';
import type { Job } from '@runner/jobs';
import type { AnyNodeDefinition, NodeDefinition } from '@runner/nodes/types';

// Standalone so node modules and the session avoid the discovery glob in `./index.ts` (Vite-only).

const nodes: AnyNodeDefinition[] = [];

/** BPMN's tasks: `bpmn:Task` and its subtypes. */
const TASKS: ReadonlySet<string> = new Set([BPMN.Task, BPMN.UserTask, BPMN.ScriptTask, BPMN.ServiceTask, BPMN.ManualTask, BPMN.SendTask, BPMN.ReceiveTask, BPMN.BusinessRuleTask]);

/** A catch event that waits for a timer. Its screen shows that wait, which is the walk's: the walk keeps the time, and
 * the step is never handed to the screen. */
export function waitsForTime(node: FlowNode): boolean {
  const definitions = Array.isArray(node.element.eventDefinitions) ? node.element.eventDefinitions : [];
  return node.type === BPMN.IntermediateCatchEvent
    && definitions.some((definition) => isElement(definition) && definition.type === 'bpmn:TimerEventDefinition');
}

export function registerNode<J extends Job, C = unknown>(def: NodeDefinition<J, C>): void {
  if (nodes.some((n) => n.type === def.type)) {
    throw new Error(`Duplicate node type '${def.type}' registered.`);
  }
  nodes.push(def);
}

export function getRegisteredNodes(): readonly AnyNodeDefinition[] {
  return nodes;
}

export function findByFlowNode(node: FlowNode): AnyNodeDefinition | undefined {
  // A catch event's screen shows its timer's wait, so a catch event that waits for none has no screen.
  if (node.type === BPMN.IntermediateCatchEvent && !waitsForTime(node)) return undefined;
  const registered = getRegisteredNodes();

  // What the step's `implementation` names runs it, whatever type the step is.
  const reference = parseImplementationRef(readString(node, 'implementation'));
  const scheme = reference.ok ? reference.value.scheme : undefined;
  if (scheme) {
    const def = registered.find((d) => 'scheme' in d.match && d.match.scheme === scheme);
    if (def) return def;
  }
  for (const def of registered) {
    if ('extensionType' in def.match && node.extensionType === def.match.extensionType) {
      return def;
    }
  }
  for (const def of registered) {
    if ('bpmnType' in def.match) {
      const types = Array.isArray(def.match.bpmnType) ? def.match.bpmnType : [def.match.bpmnType];
      if (types.includes(node.type)) return def;
    }
  }
  // `{ fallback: 'task' }` catches any task (a `bpmn:Task` subtype) the more specific matchers left unclaimed.
  if (TASKS.has(node.type)) {
    return registered.find((d) => 'fallback' in d.match && d.match.fallback === 'task');
  }
  return undefined;
}
