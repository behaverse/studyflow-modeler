import { useEffect } from 'react';
import type { FlowNode } from '@/lib/core/flow';
import type { NodeProps } from '@/runner/nodes/types';
import { NodePanel } from '../NodePanel';
import { nodeStyles } from '../styles';
import { registerNode } from '../registry';

declare module '@/runner/types' {
  interface JobsByType {
    task: TaskJob;
  }
}

type TaskJob = {
  type: 'task';
  node: FlowNode;
};

function Task({ job, log, complete }: NodeProps<TaskJob>) {
  const name = job.node.businessObject?.name || job.node.id;

  useEffect(() => {
    log('skip', `Untyped task '${job.node.id}' rendered as continue node.`);
  }, [job.node.id]);

  return (
    <NodePanel>
      <h2 className={nodeStyles.title}>{name}</h2>
      <p className={nodeStyles.subtitle}>
        This task has no applied type. Press Continue to advance.
      </p>
      <div className={nodeStyles.actions}>
        <button type="button" className={nodeStyles.primaryButton} onClick={() => complete()}>
          Continue
        </button>
      </div>
    </NodePanel>
  );
}

registerNode({
  type: 'task',
  match: { fallback: 'task' },
  toJob: (node) => ({ type: 'task', node }),
  Component: Task,
});
