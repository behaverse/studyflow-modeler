import { useEffect, useMemo, useState } from 'react';
import type { FlowNode } from '@/runner/models/flow';
import type { NodeProps } from '@/runner/models/nodes/types';
import { NodePanel } from '@/runner/views/nodes/NodePanel';
import { readString } from '@/runner/models/nodes/readAttribute';
import { validateEndEvent } from '@/runner/models/nodes/end/validation';
import { nodeStyles } from '@/runner/infra/nodes/styles';
import { registerNode } from '@/runner/controllers/nodes/registry';
import {
  type CompletionCodeType,
  readCompletionCodeType,
  resolveCompletionCode,
  substituteCompletionCode,
} from '@/runner/models/nodes/end/completionCode';

declare module '@/runner/models/jobs' {
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

function End({ job, log, setVariable, complete }: NodeProps<EndJob>) {
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
      setVariable('end.completionCode', code);
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
      <p className={nodeStyles.subtitle}>Thank you for participating.</p>

      {code && (
        <div>
          <div className={nodeStyles.subtitle}>Your completion code</div>
          <div className={nodeStyles.codeBlock}>{code}</div>
        </div>
      )}

      {redirectUrl && (
        <div className={nodeStyles.redirectInfo}>
          Redirecting in {countdown}s to{' '}
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
            Continue
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
