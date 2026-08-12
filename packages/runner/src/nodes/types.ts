import type { ComponentType } from 'react';
import type { Job } from '@runner/jobs';
import type { FlowNode } from '@runner/flow';
import type { Session } from '@runner/session';
import type { Studyflow } from '@runner/studyflow';
import type { Manifest } from '@runner/nodes/behaverse/types';

export type LogKind = 'info' | 'task' | 'ok' | 'error' | 'skip';

export type LogFn = (kind: LogKind, message: string) => void;

export type NodeProps<J extends Job = Job> = {
  job: J;
  /** Run state; `session.setVariable` is how a node publishes what it collected. */
  session: Session;
  log: LogFn;
  complete: () => void;
  abort: (reason: string) => void;
};

export type ValidationIssue = {
  nodeId: string;
  message: string;
  /** `error` (the default) stops the run; `warning` is reported and the run proceeds. */
  severity?: 'error' | 'warning';
};

type NodeMatcher =
  | { extensionType: string }
  | { bpmnType: string | string[] }
  | { fallback: 'task' };

export interface NodeDefinition<J extends Job = Job> {
  type: J['type'];
  match: NodeMatcher;
  toJob: (node: FlowNode) => J | null;
  Component: ComponentType<NodeProps<J>>;
  /** Runs once per flow node this definition matches. */
  validateNode?: (node: FlowNode, studyflow: Studyflow, manifest?: Manifest) => ValidationIssue[];
  /** Runs once per studyflow, for checks that span nodes this definition does not match. */
  validateStudyflow?: (studyflow: Studyflow, manifest?: Manifest) => ValidationIssue[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNodeDefinition = NodeDefinition<any>;
