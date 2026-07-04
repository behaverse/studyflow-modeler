import type { ComponentType } from 'react';
import type { LogKind } from '@/runner/models/log';
import type { Job } from '@/runner/models/jobs';
import type { FlowNode } from '@/runner/models/flow';
import type { Session } from '@/runner/controllers/session';
import type { Studyflow } from '@/runner/models/studyflow';
import type { Manifest } from '@/runner/models/nodes/behaverse/types';

export type NodeProps<J extends Job = Job> = {
  job: J;
  /** Runtime session. Exposes participant identity (`agentId`, `sessionId`)
   *  and the variable bag. The parsed studyflow is reachable as
   *  `session.studyflow` (`studyId`, `studyflowId`, `studyflowHash`, ...). */
  session: Session;
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
  /**
   * Per-node validation. The registry calls this only for nodes this module
   * `match`es, so implementations never re-check the node's type — `match`
   * is the single source of "which nodes are mine".
   */
  validateNode?: (node: FlowNode, studyflow: Studyflow, manifest?: Manifest) => ValidationIssue[];
  /** Flow-level validation for cross-type concerns (e.g. function calls). */
  validate?: (studyflow: Studyflow, manifest?: Manifest) => ValidationIssue[];
}
