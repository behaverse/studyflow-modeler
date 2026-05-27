import { useEffect, useRef, useState } from 'react';
import type { FlowNode } from '@/lib/core/flow';
import type { Study } from '@/runner/study';
import type { NodeProps, ValidationIssue } from '@/runner/nodes/types';
import type { BehaverseTaskPayload, Manifest } from '@/runner/nodes/behaverse/types';
import { runOnUnity, waitForReady } from './bridge';
import { buildBehaverseIframeSrc } from './iframe';
import { getBehaverseTaskPayload } from './parser';
import { validateStudy as validateBehaverseStudy } from './validator';
import { nodeStyles } from '../styles';
import { registerNode } from '../registry';

declare module '@/runner/types' {
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

function Behaverse({ job, log, complete, abort }: NodeProps<BehaverseJob>) {
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
        setStatusLine(`Running ${job.payload.task}`);
        setTimeout(() => {
          if (!cancelled) setStageReady(true);
        }, STAGE_REVEAL_DELAY_MS);

        log('task', `Run ${job.payload.task} / ${job.payload.timeline ?? '(inline)'}`);
        const result = await runOnUnity(
          unity,
          job.payload,
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
  match: { extensionType: 'behaverse:BehaverseTask' },
  toJob: behaverseToJob,
  Component: Behaverse,
  validate: (study, manifest) => manifest ? validateBehaverseStudy(study, manifest) : [],
});
