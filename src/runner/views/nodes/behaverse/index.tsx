import { useEffect, useRef, useState } from 'react';
import type { FlowNode } from '@/runner/models/flow';
import type { NodeProps } from '@/runner/models/nodes/types';
import { BEHAVERSE_TASK_TYPE, type BehaverseTaskPayload } from '@/runner/models/nodes/behaverse/types';
import { runOnUnity, waitForReady } from '@/runner/controllers/nodes/behaverse/bridge';
import { buildBehaverseIframeSrc } from '@/runner/infra/nodes/behaverse/iframe';
import { getBehaverseTaskPayload } from '@/runner/models/nodes/behaverse/parser';
import { validateBehaverseNode } from '@/runner/models/nodes/behaverse/validation';
import { nodeStyles } from '@/runner/infra/nodes/styles';
import { registerNode } from '@/runner/controllers/nodes/registry';

declare module '@/runner/models/jobs' {
  interface JobsByType {
    behaverse: BehaverseJob;
  }
}

const STAGE_REVEAL_DELAY_MS = 1000;

type BehaverseJob = {
  type: 'behaverse';
  node: FlowNode;
  payload: BehaverseTaskPayload;
};

function behaverseToJob(node: FlowNode): BehaverseJob | null {
  const payload = getBehaverseTaskPayload(node);
  return payload ? { type: 'behaverse', node, payload } : null;
}

function Behaverse({ job, session, log, complete, abort }: NodeProps<BehaverseJob>) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [stageReady, setStageReady] = useState(false);
  const [statusLine, setStatusLine] = useState('Loading Behaverse...');

  useEffect(() => {
    let cancelled = false;
    const src = buildBehaverseIframeSrc();
    if (iframeRef.current) {
      // Fresh Unity instance per task: Application.Quit tears down GameManager.
      iframeRef.current.src = src;
    }

    (async () => {
      try {
        const unity = await waitForReady(() => iframeRef.current);
        if (cancelled) return;
        setStatusLine(`Running ${job.payload.scene}`);
        setTimeout(() => {
          if (!cancelled) setStageReady(true);
        }, STAGE_REVEAL_DELAY_MS);

        log('task', `Run ${job.payload.scene} / ${job.payload.timeline ?? '(no timeline)'}`);
        const enrichedPayload: BehaverseTaskPayload = {
          ...job.payload,
          ...(session.agentId ? { agent: { id: session.agentId } } : {}),
          ...(session.studyflow.studyId ? { studyId: session.studyflow.studyId } : {}),
          ...(session.studyflow.studyflowId ? { studyflowId: session.studyflow.studyflowId } : {}),
          ...(session.sessionId ? { sessionId: session.sessionId } : {}),
          ...(session.studyflow.studyflowHash ? { studyflowHash: session.studyflow.studyflowHash } : {}),
        };
        const result = await runOnUnity(
          unity,
          enrichedPayload,
          () => iframeRef.current?.contentWindow ?? null,
          log,
        );
        if (cancelled) return;
        log(
          result.IsCompleted ? 'ok' : 'error',
          `${result.IsCompleted ? 'Completed' : 'Aborted'} ${result.TaskId} / ${result.TimelineId}`,
        );
        if (result.IsCompleted) complete(result);
        else abort(`task-aborted:${result.TaskId}`);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        log('error', `Behaverse: ${message}`);
        abort(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={nodeStyles.behaverseStage}>
      <iframe
        ref={iframeRef}
        title="Behaverse Assessment"
        className={nodeStyles.behaverseIframe}
        allow="autoplay; fullscreen"
      />
      <div
        className={`${nodeStyles.behaverseCover} ${
          stageReady ? nodeStyles.behaverseCoverHidden : nodeStyles.behaverseCoverShown
        }`}
      >
        <span>Preparing study... ({statusLine})</span>
      </div>
    </div>
  );
}

registerNode({
  type: 'behaverse',
  match: { extensionType: BEHAVERSE_TASK_TYPE },
  toJob: behaverseToJob,
  Component: Behaverse,
  validateNode: (node, _studyflow, manifest) => manifest ? validateBehaverseNode(node, manifest) : [],
});
