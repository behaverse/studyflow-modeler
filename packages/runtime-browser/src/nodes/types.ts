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
  /** The step it is about; none for what is not about one (a value the link leaves unset). */
  nodeId?: string;
  message: string;
  /** `error` (the default) stops the run; `warning` is reported and the run proceeds. */
  severity?: 'error' | 'warning';
};

type NodeMatcher =
  | { scheme: string }
  | { extensionType: string }
  | { bpmnType: string | string[] }
  | { fallback: 'task' };

/** `C` is what `prepare` fetches for the validators (a build manifest, say); the runner never reads it. */
export interface NodeDefinition<J extends Job = Job, C = unknown> {
  type: J['type'];
  match: NodeMatcher;
  toJob: (node: FlowNode) => J | null;
  Component: ComponentType<NodeProps<J>>;
  /**
   * Whether this screen itself plays the pool on the step's band: a program it asks for each answer, or one that
   * plays inside what the screen runs. The exchange the band stands for then happens in the screen. A band that
   * names a program no screen plays is refused, since no one in the page answers for that pool.
   */
  playsBand?: (node: FlowNode) => boolean;
  /**
   * The data objects wired into the step that this screen reads itself, by id: a prompt it sends a model, say. A
   * screen is handed the Parameters wired into its step and no other data input, so the page warns of each one that
   * no screen reads.
   */
  reads?: (node: FlowNode) => string[];
  /**
   * This screen gives its step a result (`session.answer`), which the page writes along the step's data outputs as
   * the walk writes a runner's. The page warns of a data output of a step whose screen gives none.
   */
  answers?: boolean;
  /**
   * This definition mounts a long screen: a task that boots an engine, an
   * instrument with many items. Debug (`?debug=1`) shows its name instead
   * of running it; cheap nodes ignore the flag and run for real.
   */
  heavy?: boolean;
  /** Runs once per studyflow before validation; what it returns reaches this definition's validators. */
  prepare?: (studyflow: Studyflow, log: LogFn) => Promise<C | undefined>;
  /** Runs once per flow node this definition matches. */
  validateNode?: (node: FlowNode, studyflow: Studyflow, context?: C) => ValidationIssue[];
  /** Runs once per studyflow, for checks that span nodes this definition does not match. */
  validateStudyflow?: (studyflow: Studyflow, context?: C) => ValidationIssue[];
}

export type AnyNodeDefinition = NodeDefinition<any, any>;
