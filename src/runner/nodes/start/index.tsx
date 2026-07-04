import { useEffect, useState } from 'react';
import type { FlowNode } from '@/lib/core/flow';
import type { NodeProps, ValidationIssue } from '@/runner/nodes/types';
import { NodePanel } from '../NodePanel';
import { readString } from '../readAttribute';
import { nodeStyles } from '../styles';
import { registerNode } from '../registry';

declare module '@/runner/types' {
  interface JobsByType {
    start: StartJob;
  }
}

type StartJob = {
  type: 'start';
  node: FlowNode;
  consentFormUri?: string;
  studyName?: string;
};

function Start({ job, log, setVariable, complete, abort }: NodeProps<StartJob>) {
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
      <NodePanel>
        <h2 className={nodeStyles.title}>{title}</h2>
        <p className={nodeStyles.subtitle}>Welcome. Press Begin to start the study.</p>
        <div className={nodeStyles.actions}>
          <button type="button" className={nodeStyles.primaryButton} onClick={() => complete()}>
            Begin
          </button>
        </div>
      </NodePanel>
    );
  }

  const formContent = consentText ?? fetchError ?? 'Loading consent form...';

  return (
    <NodePanel>
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
    </NodePanel>
  );
}

function validateStartEvent(node: FlowNode): ValidationIssue[] {
  const consentFormUri = readString(node, 'consentFormUri') ?? '';
  if (consentFormUri && !/^(https?:|\/)/i.test(consentFormUri)) {
    return [{
      nodeId: node.id,
      message: `consentFormUri '${consentFormUri}' does not look like a URL or absolute path.`,
    }];
  }
  return [];
}

registerNode({
  type: 'start',
  match: { bpmnType: 'bpmn:StartEvent' },
  toJob: (node) => ({
    type: 'start',
    node,
    consentFormUri: readString(node, 'consentFormUri'),
    studyName: node.businessObject?.name || undefined,
  }),
  Component: Start,
  validateNode: validateStartEvent,
});
