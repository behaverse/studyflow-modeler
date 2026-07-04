import { useEffect, useMemo, useState } from 'react';
import { getAttribute } from '@/lib/core/extensions';
import type { FlowNode } from '@/lib/core/flow';
import type { NodeProps, ValidationIssue } from '@/runner/nodes/types';
import { NodePanel } from '../NodePanel';
import { readString } from '../readAttribute';
import { nodeStyles } from '../styles';
import { registerNode } from '../registry';
import {
  type CompletionCodeType,
  resolveCompletionCode,
  substituteCompletionCode,
} from './completionCode';

declare module '@/runner/types' {
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

function readCompletionCodeType(node: FlowNode): CompletionCodeType {
  return (getAttribute(node.businessObject, 'completionCodeType') as CompletionCodeType | undefined) ?? 'none';
}

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

function validateEndEvent(node: FlowNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const redirectTo = readString(node, 'redirectTo') ?? '';
  const completionCodeType = readCompletionCodeType(node);
  const completionCode = readString(node, 'completionCode') ?? '';

  if (completionCodeType === 'static' && !completionCode) {
    issues.push({
      nodeId: node.id,
      message: `EndEvent '${node.id}' uses static completionCode but no completionCode value is set.`,
    });
  }
  if (redirectTo.includes('{COMPLETION_CODE}') && completionCodeType === 'none') {
    issues.push({
      nodeId: node.id,
      message: `EndEvent '${node.id}': redirectTo references {COMPLETION_CODE} but completionCodeType is 'none'.`,
    });
  }
  return issues;
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
