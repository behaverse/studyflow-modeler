import { useEffect } from 'react';
import type { FlowNode } from '../../types';
import type { NodeProps } from '../types';
import { nodeStyles } from '../styles';
import { registerNode } from '../registry';

declare module '@/runtime/types' {
  interface JobsByKind {
    task: TaskJob;
  }
}

export type TaskJob = {
  kind: 'task';
  node: FlowNode;
};

export function taskToJob(node: FlowNode): TaskJob {
  return { kind: 'task', node };
}

export function Task({ job, log, complete }: NodeProps<TaskJob>) {
  const name = job.node.businessObject?.name || job.node.id;

  useEffect(() => {
    log('skip', `Untyped task '${job.node.id}' rendered as continue node.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.node.id]);

  return (
    <div className={nodeStyles.card}>
      <div className={nodeStyles.panel}>
        <h2 className={nodeStyles.title}>{name}</h2>
        <p className={nodeStyles.subtitle}>
          This task has no applied type. Press Continue to advance.
        </p>
        <div className={nodeStyles.actions}>
          <button
            type="button"
            className={nodeStyles.primaryButton}
            onClick={() => complete()}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

registerNode({
  kind: 'task',
  match: { fallback: 'task' },
  toJob: taskToJob,
  Component: Task,
});
