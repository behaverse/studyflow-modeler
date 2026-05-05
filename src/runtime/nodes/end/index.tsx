import { useEffect, useMemo, useState } from 'react';
import { getProperty } from '@/modeler/extensions/resolve';
import type { Process, FlowNode } from '../../types';
import type { ValidationIssue } from '../behaverse/types';
import { type NodeProps, readBoolProperty } from '../types';
import { nodeStyles } from '../styles';
import { registerNode } from '../registry';
import {
  type CompletionCodeType,
  resolveCompletionCode,
  substituteCompletionCode,
} from './completionCode';

declare module '@/runtime/types' {
  interface JobsByKind {
    end: EndJob;
  }
}

const REDIRECT_TIMEOUT = 5;  // seconds

export type EndJob = {
  kind: 'end';
  node: FlowNode;
  hasRedirectUrl: boolean;
  redirectTo?: string;
  completionCodeType: CompletionCodeType;
  completionCode?: string;
};

export function endToJob(node: FlowNode): EndJob {
  const hasRedirectUrl = readBoolProperty(node.businessObject, 'hasRedirectUrl');
  const redirectTo = (getProperty(node.businessObject, 'redirectTo') as string) || undefined;
  const completionCodeType =
    ((getProperty(node.businessObject, 'completionCodeType') as string) as CompletionCodeType) ||
    'none';
  const completionCode = (getProperty(node.businessObject, 'completionCode') as string) || undefined;

  return {
    kind: 'end',
    node,
    hasRedirectUrl,
    redirectTo,
    completionCodeType,
    completionCode,
  };
}

export function End({ job, log, complete }: NodeProps<EndJob>) {
  const code = useMemo(
    () => resolveCompletionCode(job.completionCodeType, job.completionCode),
    [job.completionCodeType, job.completionCode],
  );
  const redirectUrl = useMemo(() => {
    if (!job.hasRedirectUrl || !job.redirectTo) return null;
    return substituteCompletionCode(job.redirectTo, code);
  }, [job.hasRedirectUrl, job.redirectTo, code]);

  const [countdown, setCountdown] = useState<number | null>(redirectUrl ? REDIRECT_TIMEOUT : null);

  useEffect(() => {
    if (code) log('info', `Completion code: ${code}`);
    if (redirectUrl) log('info', `Will redirect to: ${redirectUrl}`);
    // End is the last job — signal completion to the executor immediately
    // so the executor reaches `done` phase. The component stays mounted so the
    // user can read the code / countdown.
    complete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      if (redirectUrl) window.location.href = redirectUrl;
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [countdown, redirectUrl]);

  return (
    <div className={nodeStyles.card}>
      <div className={nodeStyles.panel}>
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
              onClick={() => {
                window.location.href = redirectUrl;
              }}
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function validate(process: Process): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of process.nodes.values()) {
    if (node.type !== 'bpmn:EndEvent') continue;
    const hasRedirectUrl = readBoolProperty(node.businessObject, 'hasRedirectUrl');
    const redirectTo = (getProperty(node.businessObject, 'redirectTo') as string) || '';
    const completionCodeType =
      ((getProperty(node.businessObject, 'completionCodeType') as string) as CompletionCodeType) ||
      'none';
    const completionCode = (getProperty(node.businessObject, 'completionCode') as string) || '';

    if (hasRedirectUrl && !redirectTo) {
      issues.push({
        nodeId: node.id,
        message: `EndEvent '${node.id}' has hasRedirectUrl=true but no redirectTo.`,
      });
    }
    if (completionCodeType === 'static' && !completionCode) {
      issues.push({
        nodeId: node.id,
        message: `EndEvent '${node.id}' uses static completionCode but no completionCode value is set.`,
      });
    }
    if (
      hasRedirectUrl &&
      redirectTo &&
      redirectTo.includes('{COMPLETION_CODE}') &&
      completionCodeType === 'none'
    ) {
      issues.push({
        nodeId: node.id,
        message: `EndEvent '${node.id}': redirectTo references {COMPLETION_CODE} but completionCodeType is 'none'.`,
      });
    }
  }
  return issues;
}

registerNode({
  kind: 'end',
  match: { bpmnType: 'bpmn:EndEvent' },
  toJob: endToJob,
  Component: End,
  validate,
});
