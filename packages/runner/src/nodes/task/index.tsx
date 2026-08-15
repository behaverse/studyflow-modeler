import { useEffect } from 'react';
import type { FlowNode } from '@runner/flow';
import type { NodeProps } from '@runner/nodes/types';
import { NodePanel } from '@runner/nodes/NodePanel';
import { nodeStyles } from '@runner/nodes/styles';
import { registerNode } from '@runner/nodes/registry';
import {
  readImplementation,
  resolveImplementation,
  validateImplementations,
} from '@runner/nodes/implementationRef';

declare module '@runner/jobs' {
  interface JobsByType {
    task: TaskJob;
  }
}

const cn = {
  field: 'flex flex-col gap-1',
  defList: 'text-sm text-stone-700 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1',
  term: 'text-stone-500',
  monoValue: 'font-mono break-all',
} as const;

type TaskJob = {
  type: 'task';
  node: FlowNode;
};

function ImplementationPanel({ node }: { node: FlowNode }) {
  const implementation = readImplementation(node);
  if (!implementation) return null;
  const resolved = resolveImplementation(implementation);
  const argEntries = resolved.args ? Object.entries(resolved.args) : [];

  return (
    <div className="border border-stone-200 rounded p-4 bg-stone-50 flex flex-col gap-3">
      <div className={cn.field}>
        <span className={nodeStyles.subtitle}>Would call</span>
        <code className={nodeStyles.codeBlock}>{implementation.ref}</code>
      </div>
      {resolved.parsed && (
        <dl className={cn.defList}>
          <dt className={cn.term}>scheme</dt>
          <dd className="font-mono">{resolved.parsed.scheme}</dd>
          <dt className={cn.term}>ref</dt>
          <dd className={cn.monoValue}>{resolved.parsed.ref}</dd>
          {resolved.parsed.version && (
            <>
              <dt className={cn.term}>version</dt>
              <dd className={cn.monoValue}>{resolved.parsed.version}</dd>
            </>
          )}
        </dl>
      )}
      {argEntries.length > 0 && (
        <div className={cn.field}>
          <span className={nodeStyles.subtitle}>additionalArguments</span>
          <dl className={cn.defList}>
            {argEntries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="font-mono text-stone-500">{key}</dt>
                <dd className={cn.monoValue}>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <p className={nodeStyles.subtitle}>
        The browser runner does not execute function calls; the Python runner does.
      </p>
    </div>
  );
}

function Task({ job, log, complete }: NodeProps<TaskJob>) {
  const name = job.node.businessObject?.name || job.node.id;
  const implementation = readImplementation(job.node);

  useEffect(() => {
    if (implementation) {
      log('info', `Task '${job.node.id}' declares a function call: ${implementation.ref}`);
    } else {
      log('skip', `Task '${job.node.id}' has no applied type, so it only shows a Continue button.`);
    }
  }, [job.node.id]);

  return (
    <NodePanel>
      <h2 className={nodeStyles.title}>{name}</h2>
      {implementation ? (
        <ImplementationPanel node={job.node} />
      ) : (
        <p className={nodeStyles.subtitle}>
          Nothing happens at this step. Press Continue to go on.
        </p>
      )}
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
  validateStudyflow: validateImplementations,
});
