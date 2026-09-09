import type { ComponentType } from 'react';
import type { Job } from '@runner/jobs';
import type { FlowNode } from '@runner/flow';
import type { Session } from '@runner/session';
import type { Studyflow } from '@runner/studyflow';

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

/** `C` is what `prepare` fetches for the validators (a build manifest, say); the runner never reads it. */
export interface NodeDefinition<J extends Job = Job, C = unknown> {
  type: J['type'];
  match: NodeMatcher;
  toJob: (node: FlowNode) => J | null;
  Component: ComponentType<NodeProps<J>>;
  /** Runs once per studyflow before validation; what it returns reaches this definition's validators. */
  prepare?: (studyflow: Studyflow, log: LogFn) => Promise<C | undefined>;
  /** Runs once per flow node this definition matches. */
  validateNode?: (node: FlowNode, studyflow: Studyflow, context?: C) => ValidationIssue[];
  /** Runs once per studyflow, for checks that span nodes this definition does not match. */
  validateStudyflow?: (studyflow: Studyflow, context?: C) => ValidationIssue[];
}

export type AnyNodeDefinition = NodeDefinition<any, any>;
