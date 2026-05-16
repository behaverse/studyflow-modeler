import { useCallback, useRef } from 'react';
import type { Job } from '@/runner/types';
import type { LogKind } from '../styles';
import type { NodeProps } from '@/runner/nodes/types';
import { findByType } from './';

export type NodeOutcome =
  | { kind: 'complete'; result?: unknown }
  | { kind: 'abort'; reason: string };

type Props = {
  job: Job;
  log: (kind: LogKind, message: string) => void;
  setVariable: (name: string, value: unknown) => void;
  onResolve: (outcome: NodeOutcome) => void;
};

/** Mounts the component for the job's type; `onResolve` fires once per mount. */
export function NodeRenderer({ job, log, setVariable, onResolve }: Props) {
  const resolvedRef = useRef(false);

  const resolveOnce = useCallback((outcome: NodeOutcome) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onResolve(outcome);
  }, [onResolve]);

  const complete = useCallback((result?: unknown) => resolveOnce({ kind: 'complete', result }), [resolveOnce]);
  const abort = useCallback((reason: string) => resolveOnce({ kind: 'abort', reason }), [resolveOnce]);

  const def = findByType(job.type);
  if (!def) {
    resolveOnce({ kind: 'abort', reason: `unknown-job-type:${job.type}` });
    return null;
  }

  const Component = def.Component;
  return <Component {...({ job, log, setVariable, complete, abort } as NodeProps<any>)} />;
}
