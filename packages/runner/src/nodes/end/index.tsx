import { useEffect, useMemo, useState } from 'react';
import { readString, type FlowNode } from '@runner/flow';
import type { NodeProps } from '@runner/nodes/types';
import { NodePanel } from '@runner/nodes/NodePanel';
import { nodeStyles } from '@runner/nodes/styles';
import { registerNode } from '@runner/nodes/registry';
import {
  readCompletionCodeType,
  resolveCompletionCode,
  substituteCompletionCode,
  type CompletionCodeType,
} from '@runner/nodes/end/completionCode';
import { validateEndEvent } from '@runner/nodes/end/validation';

declare module '@runner/jobs' {
  interface JobsByType {
    end: EndJob;
  }
}

const REDIRECT_TIMEOUT = 5;  // seconds

type EndJob = {
  type: 'end';
  node: FlowNode;
  redirectTo?: string;
  completionCodeType: CompletionCodeType;
  completionCode?: string;
};

function End({ job, session, log, complete }: NodeProps<EndJob>) {
  const code = useMemo(
    () => resolveCompletionCode(job.completionCodeType, job.completionCode),
    [job.completionCodeType, job.completionCode],
  );
  const redirectUrl = useMemo(
    () => (job.redirectTo ? substituteCompletionCode(job.redirectTo, code) : null),
    [job.redirectTo, code],
  );

  const [countdown, setCountdown] = useState<number | null>(redirectUrl ? REDIRECT_TIMEOUT : null);

  useEffect(() => {
    if (code) {
      log('info', `Completion code: ${code}`);
      session.setVariable('end.completionCode', code);
    }
    if (redirectUrl) log('info', `Will redirect to: ${redirectUrl}`);
    // Signal the executor so it reaches the `done` phase; the component stays mounted for the user.
    complete();
  }, []);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      if (redirectUrl) window.location.href = redirectUrl;
      return;
    }
    const timerId = window.setTimeout(
      () => setCountdown((current) => (current === null ? null : current - 1)),
      1000,
    );
    return () => window.clearTimeout(timerId);
  }, [countdown, redirectUrl]);

  return (
    <NodePanel>
      <h2 className={nodeStyles.title}>Study complete</h2>
      <p className={nodeStyles.subtitle}>
        Thank you for participating.{!code && !redirectUrl && ' You can close this page now.'}
      </p>

      {code && (
        <div className={nodeStyles.completionBox}>
          <div className={nodeStyles.completionLabel}>Your completion code</div>
          <div className={nodeStyles.completionCode}>{code}</div>
          <p className={nodeStyles.subtitle}>
            Copy this code back into the page that sent you here. You need it to be credited.
          </p>
        </div>
      )}

      {redirectUrl && (
        <div className={nodeStyles.redirectInfo}>
          We will send you back in {countdown}s to{' '}
          <span className="break-all">{redirectUrl}</span>
        </div>
      )}

      <div className={nodeStyles.actions}>
        {redirectUrl && (
          <button
            type="button"
            className={nodeStyles.primaryButton}
            onClick={() => { window.location.href = redirectUrl; }}
          >
            Go back now
          </button>
        )}
      </div>
    </NodePanel>
  );
}

registerNode({
  type: 'end',
  match: { bpmnType: 'bpmn:EndEvent' },
  toJob: (node) => ({
    type: 'end',
    node,
    redirectTo: readString(node, 'redirectTo'),
    completionCodeType: readCompletionCodeType(node),
    completionCode: readString(node, 'completionCode'),
  }),
  Component: End,
  validateNode: validateEndEvent,
});
