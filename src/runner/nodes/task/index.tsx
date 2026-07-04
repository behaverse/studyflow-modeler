import { useEffect } from 'react';
import type { FlowNode } from '@/lib/core/flow';
import type { NodeProps } from '@/runner/nodes/types';
import { NodePanel } from '../NodePanel';
import { nodeStyles } from '../styles';
import { registerNode } from '../registry';
import { readFunctionCall, resolveFunctionCall, validateFunctionCalls } from '../functionCall';

declare module '@/runner/types' {
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

function FunctionCallPanel({ node }: { node: FlowNode }) {
  const call = readFunctionCall(node);
  if (!call) return null;
  const resolved = resolveFunctionCall(call);
  const argEntries = resolved.args ? Object.entries(resolved.args) : [];

  return (
    <div className="border border-stone-200 rounded p-4 bg-stone-50 flex flex-col gap-3">
      <div className={cn.field}>
        <span className={nodeStyles.subtitle}>Would call</span>
        <code className={nodeStyles.codeBlock}>{call.functionRef}</code>
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
          <span className={nodeStyles.subtitle}>arguments</span>
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
      <p className={nodeStyles.subtitle}>Function calls are not executed in the browser runner.</p>
    </div>
  );
}

function Task({ job, log, complete }: NodeProps<TaskJob>) {
  const name = job.node.businessObject?.name || job.node.id;
  const call = readFunctionCall(job.node);

  useEffect(() => {
    if (call) {
      log('info', `Task '${job.node.id}' declares a function call: ${call.functionRef}`);
    } else {
      log('skip', `Untyped task '${job.node.id}' rendered as continue node.`);
    }
  }, [job.node.id]);

  return (
    <NodePanel>
      <h2 className={nodeStyles.title}>{name}</h2>
      {call ? (
        <FunctionCallPanel node={job.node} />
      ) : (
        <p className={nodeStyles.subtitle}>
          This task has no applied type. Press Continue to advance.
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
  validate: (studyflow) => validateFunctionCalls(studyflow),
});
