import type { ComponentType } from 'react';
import type { LogKind } from '../styles';
import type { Job } from '@/runner/types';
import type { FlowNode } from '@/lib/core/flow';
import type { Study } from '@/runner/study';
import type { Manifest } from './behaverse/types';

export type NodeProps<J extends Job = Job> = {
  job: J;
  /** Study reference; exposes runtime identity (`agentId`, `sessionId`,
   *  `studyId`, `studyflowId`) and the variable bag for downstream nodes. */
  study: Study;
  log: (kind: LogKind, message: string) => void;
  setVariable: (name: string, value: unknown) => void;
  complete: (result?: unknown) => void;
  abort: (reason: string) => void;
};

/** Issue produced by a node's `validate` step; surfaced before traversal. */
export type ValidationIssue = {
  nodeId: string;
  taskId?: string;
  timelineId?: string;
  message: string;
};

/** Registry precedence: extensionType -> bpmnType -> fallback. */
type NodeMatcher =
  | { extensionType: string }
  | { bpmnType: string | string[] }
  | { fallback: 'task' };

/** One node module's contribution: recognize, transform, render, validate. */
export interface NodeDefinition<J extends { type: string; node: FlowNode } = { type: string; node: FlowNode }> {
  type: J['type'];
  match: NodeMatcher;
  toJob: (node: FlowNode) => J | null;
  Component: ComponentType<NodeProps<J>>;
  validate?: (study: Study, manifest?: Manifest) => ValidationIssue[];
}
