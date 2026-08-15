import { useEffect, useState } from 'react';
import { readString, type FlowNode } from '@runner/flow';
import type { NodeProps } from '@runner/nodes/types';
import { NodePanel } from '@runner/nodes/NodePanel';
import { nodeStyles } from '@runner/nodes/styles';
import { registerNode } from '@runner/nodes/registry';
import { validateStartEvent } from '@runner/nodes/start/validation';

declare module '@runner/jobs' {
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

function Start({ job, session, log, complete, abort }: NodeProps<StartJob>) {
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
          setFetchError('The consent form could not be loaded. Please contact the researcher before you continue.');
          log('error', `Could not fetch consentFormUri '${job.consentFormUri}': ${err.message}`);
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
        <p className={nodeStyles.subtitle}>Thank you for taking part. Press Begin when you are ready.</p>
        <div className={nodeStyles.actions}>
          <button type="button" className={nodeStyles.primaryButton} onClick={() => complete()}>
            Begin
          </button>
        </div>
      </NodePanel>
    );
  }

  const formContent = consentText ?? fetchError ?? 'Loading the consent form...';

  return (
    <NodePanel>
      <h2 className={nodeStyles.title}>{title}</h2>
      <p className={nodeStyles.subtitle}>Informed consent</p>
      <div className={nodeStyles.consentBox}>{formContent}</div>
      <p className={nodeStyles.subtitle}>
        Please read the form above, then choose whether to take part.
      </p>
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
            session.setVariable('start.consentGiven', true);
            complete();
          }}
        >
          I consent
        </button>
      </div>
    </NodePanel>
  );
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
