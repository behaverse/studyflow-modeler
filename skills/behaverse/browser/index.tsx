import { useEffect, useRef, useState } from 'react';
import type { FlowNode } from '@runner/flow';
import type { LogFn, NodeProps } from '@runner/nodes/types';
import type { Studyflow } from '@runner/studyflow';
import {
  BEHAVERSE_RUNTIME_URL,
  BEHAVERSE_TASK_TYPE,
  buildBehaverseIframeSrc,
  type BehaverseTaskPayload,
  type Manifest,
} from '@skills/behaverse/browser/types';
import { runOnUnity, waitForReady } from '@skills/behaverse/browser/unityRuntime';
import { getBehaverseTaskPayload, withRunIdentity } from '@skills/behaverse/browser/parser';
import { fetchManifest, validateBehaverseNode } from '@skills/behaverse/browser/validation';
import { nodeStyles } from '@runner/nodes/styles';
import { registerNode } from '@runner/nodes/registry';

declare module '@runner/jobs' {
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
  const [statusLine, setStatusLine] = useState('Loading the task...');

  useEffect(() => {
    let cancelled = false;
    const src = buildBehaverseIframeSrc();
    if (iframeRef.current) {
      // Fresh Unity instance per task: Application.Quit tears down the AssessmentRuntime.
      iframeRef.current.src = src;
    }

    (async () => {
      try {
        const unity = await waitForReady(() => iframeRef.current);
        if (cancelled) return;
        setStatusLine('Starting the task...');
        setTimeout(() => {
          if (!cancelled) setStageReady(true);
        }, STAGE_REVEAL_DELAY_MS);

        log('task', `Running ${job.payload.scene} / ${job.payload.timeline ?? '(no timeline)'}.`);
        const result = await runOnUnity(
          unity,
          withRunIdentity(job.payload, session),
          () => iframeRef.current?.contentWindow ?? null,
          log,
        );
        if (cancelled) return;
        log(
          result.IsCompleted ? 'ok' : 'error',
          `${result.IsCompleted ? 'Completed' : 'Stopped before the end:'} ${result.TaskId} / ${result.TimelineId}.`,
        );
        if (result.IsCompleted) complete();
        else abort(`task-aborted:${result.TaskId}`);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        log('error', `Behaverse task '${job.node.id}' could not run: ${message}`);
        abort(message);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Each is fixed for the node's mount: the runner keys a node by its job and hands it stable callbacks.
  }, [job, session, log, complete, abort]);

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
        <span>{statusLine}</span>
      </div>
    </div>
  );
}

/** The Unity build's manifest, which the validator checks scenes and timelines against; without it, nothing is checked. */
async function prepare(studyflow: Studyflow, log: LogFn): Promise<Manifest | undefined> {
  const needed = [...studyflow.flowNodes.values()].some((node) => node.extensionType === BEHAVERSE_TASK_TYPE);
  if (!needed) {
    log('info', 'No Behaverse task in this studyflow.');
    return undefined;
  }
  try {
    return await fetchManifest(BEHAVERSE_RUNTIME_URL);
  } catch (err) {
    log('skip', `Could not load the Behaverse Unity build (${err instanceof Error ? err.message : String(err)}). `);
    return undefined;
  }
}

registerNode<BehaverseJob, Manifest>({
  type: 'behaverse',
  match: { extensionType: BEHAVERSE_TASK_TYPE },
  toJob: behaverseToJob,
  Component: Behaverse,
  prepare,
  validateNode: (node, _studyflow, manifest) => manifest ? validateBehaverseNode(node, manifest) : [],
});
