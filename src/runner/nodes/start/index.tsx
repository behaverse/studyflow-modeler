import { useEffect, useState } from 'react';
import { getProperty } from '@/lib/core/extensions/resolve';
import type { FlowNode } from '@/lib/core/flow';
import type { Study } from '@/runner/study';
import type { ValidationIssue } from '../behaverse/types';
import { type NodeProps } from '@/runner/nodes/types';
import { nodeStyles } from '../styles';
import { registerNode } from '../registry';

declare module '@/runner/types' {
  interface JobsByKind {
    start: StartJob;
  }
}

export type StartJob = {
  kind: 'start';
  node: FlowNode;
  consentFormUri?: string;
  studyName?: string;
};

export function startToJob(node: FlowNode): StartJob {
  const consentFormUri = (getProperty(node.businessObject, 'consentFormUri') as string) || undefined;
  const studyName = node.businessObject?.name || undefined;
  return {
    kind: 'start',
    node,
    consentFormUri,
    studyName,
  };
}

export function Start({ job, log, setVariable, complete, abort }: NodeProps<StartJob>) {
  const [consentText, setConsentText] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const title = job.studyName || 'Study';

  useEffect(() => {
    if (!job.consentFormUri) return;
    let cancelled = false;
    fetch(job.consentFormUri)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) setConsentText(text);
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(`Could not load consent form: ${err.message}`);
          log('error', `consentFormUri fetch failed: ${err.message}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [job.consentFormUri, log]);

  if (!job.consentFormUri) {
    return (
      <div className={nodeStyles.card}>
        <div className={nodeStyles.panel}>
          <h2 className={nodeStyles.title}>{title}</h2>
          <p className={nodeStyles.subtitle}>Welcome. Press Begin to start the study.</p>
          <div className={nodeStyles.actions}>
            <button
              type="button"
              className={nodeStyles.primaryButton}
              onClick={() => complete()}
            >
              Begin
            </button>
          </div>
        </div>
      </div>
    );
  }

  const formContent = job.consentFormUri
    ? consentText ?? fetchError ?? 'Loading consent form...'
    : 'Please confirm that you consent to participate in this study.';

  return (
    <div className={nodeStyles.card}>
      <div className={nodeStyles.panel}>
        <h2 className={nodeStyles.title}>{title}</h2>
        <p className={nodeStyles.subtitle}>Informed consent</p>
        <div className={nodeStyles.consentBox}>{formContent}</div>
        <div className={nodeStyles.actions}>
          <button
            type="button"
            className={nodeStyles.secondaryButton}
            onClick={() => {
              log('skip', 'Participant declined consent.');
              abort('consent-declined');
            }}
          >
            Decline
          </button>
          <button
            type="button"
            className={nodeStyles.primaryButton}
            onClick={() => {
              setVariable('start.consentGiven', true);
              complete();
            }}
          >
            I consent
          </button>
        </div>
      </div>
    </div>
  );
}

export function validate(study: Study): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of study.nodes.values()) {
    if (node.type !== 'bpmn:StartEvent') continue;
    const consentFormUri = (getProperty(node.businessObject, 'consentFormUri') as string) || '';
    if (consentFormUri && !/^(https?:|\/)/i.test(consentFormUri)) {
      issues.push({
        nodeId: node.id,
        message: `consentFormUri '${consentFormUri}' does not look like a URL or absolute path.`,
      });
    }
  }
  return issues;
}

registerNode({
  kind: 'start',
  match: { bpmnType: 'bpmn:StartEvent' },
  toJob: startToJob,
  Component: Start,
  validate,
});
