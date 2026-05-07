import { useCallback, useRef } from 'react';
import type { Job } from '../types';
import type { LogKind } from '../styles';
import type { NodeProps } from './types';
import { findByKind } from './';

export type NodeOutcome =
  | { kind: 'complete'; result?: unknown }
  | { kind: 'abort'; reason: string };

type Props = {
  job: Job;
  log: (kind: LogKind, message: string) => void;
  setVariable: (name: string, value: unknown) => void;
  onResolve: (outcome: NodeOutcome) => void;
};

/**
 * Mounts the React component for the current job's kind. The component
 * reports its outcome via `complete()` / `abort()` callbacks; `onResolve` is
 * invoked exactly once per mount and the parent advances Graph.
 *
 * Re-mount on job change is enforced by the parent passing a `key` prop
 * (typically the job's node id) so two consecutive jobs of the same kind
 * don't share component state - and the resolved-guard ref resets too.
 */
export function NodeRenderer({ job, log, setVariable, onResolve }: Props) {
  const resolvedRef = useRef(false);

  const complete = useCallback(
    (result?: unknown) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      onResolve({ kind: 'complete', result });
    },
    [onResolve],
  );
  const abort = useCallback(
    (reason: string) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      onResolve({ kind: 'abort', reason });
    },
    [onResolve],
  );

  const props = { job, log, setVariable, complete, abort } as NodeProps<any>;

  const def = findByKind(job.kind);
  if (!def) {
    if (!resolvedRef.current) {
      resolvedRef.current = true;
      onResolve({ kind: 'abort', reason: `unknown-job-kind:${job.kind}` });
    }
    return null;
  }
  const Component = def.Component;
  return <Component {...props} />;
}
