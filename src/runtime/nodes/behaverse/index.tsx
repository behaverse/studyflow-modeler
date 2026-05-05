import { useEffect, useRef, useState } from 'react';
import type { NodeProps } from '../types';
import type { Process, FlowNode } from '../../types';
import type { BehaverseTaskPayload, Manifest, ValidationIssue } from './types';
import { runOnUnity, waitForUnity, waitForRunnerReady } from './bridge';
import { buildBehaverseIframeSrc } from './iframe';
import { getBehaverseTaskPayload } from './parser';
import { validateProcess as validateBehaverseProcess } from './validator';
import { nodeStyles } from '../styles';
import { registerNode } from '../registry';

declare module '@/runtime/types' {
  interface JobsByKind {
    behaverse: BehaverseJob;
  }
}

// Behaverse-side ready event timing.
const STARTUP_GRACE_MS = 1000;
const STAGE_REVEAL_DELAY_MS = 1500;

export type BehaverseJob = {
  kind: 'behaverse';
  node: FlowNode;
  payload: BehaverseTaskPayload;
};

export function behaverseToJob(node: FlowNode): BehaverseJob | null {
  const payload = getBehaverseTaskPayload(node);
  if (!payload) return null;
  return { kind: 'behaverse', node, payload };
}

export function Behaverse({ job, log, complete, abort }: NodeProps<BehaverseJob>) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [stageReady, setStageReady] = useState(false);
  const [statusLine, setStatusLine] = useState('Loading Behaverse...');

  useEffect(() => {
    let cancelled = false;
    const src = buildBehaverseIframeSrc();
    if (iframeRef.current) {
      // Force a full reload so each task gets a fresh Unity instance — Unity
      // tears down on Application.Quit and re-using the iframe races against
      // the half-destroyed previous GameManager.
      iframeRef.current.src = src;
    }

    (async () => {
      try {
        const unity = await waitForUnity(() => iframeRef.current);
        if (cancelled) return;
        const ready = await waitForRunnerReady(() => iframeRef.current);
        if (cancelled) return;
        if (ready === 'timeout') {
          await new Promise((r) => setTimeout(r, STARTUP_GRACE_MS));
        }
        setStatusLine(`Running ${job.payload.task}`);
        setTimeout(() => {
          if (!cancelled) setStageReady(true);
        }, STAGE_REVEAL_DELAY_MS);

        log('task', `Run ${job.payload.task} / ${job.payload.timeline ?? '(inline)'}`);
        const result = await runOnUnity(
          unity,
          job.payload,
          () => iframeRef.current?.contentWindow ?? null,
        );
        if (cancelled) return;
        log(
          result.isCompleted ? 'ok' : 'error',
          `${result.isCompleted ? 'Completed' : 'Aborted'} ${result.taskId} / ${result.timelineId}`,
        );
        if (result.isCompleted) complete(result);
        else abort(`task-aborted:${result.taskId}`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

export function validate(process: Process, manifest?: Manifest): ValidationIssue[] {
  return manifest ? validateBehaverseProcess(process, manifest) : [];
}

registerNode({
  kind: 'behaverse',
  match: { appliedType: 'behaverse:BehaverseTask' },
  toJob: behaverseToJob,
  Component: Behaverse,
  validate,
});

export type {
  BehaverseTaskPayload,
  Manifest,
  ManifestTask,
  ValidationIssue,
} from './types';
export type { UnityInstance, TaskCompletion } from './bridge';
export { runOnUnity, waitForUnity, waitForRunnerReady } from './bridge';
export { buildBehaverseIframeSrc, BEHAVERSE_RUNTIME_URL } from './iframe';
export { fetchManifest } from './validator';
export { getBehaverseTaskPayload, ensureExtensionElementResolved } from './parser';
