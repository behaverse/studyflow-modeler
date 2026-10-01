import { useMemo, useState } from 'react';
import type { Message } from '@core/engine';
import { readString, type FlowNode } from '@runner/flow';
import type { NodeProps } from '@runner/nodes/types';
import { NodePanel } from '@runner/nodes/NodePanel';
import { nodeStyles } from '@runner/nodes/styles';
import { registerNode } from '@runner/nodes/registry';
import { viewOf } from '@runner/nodes/message/view';

declare module '@runner/jobs' {
  interface JobsByType {
    message: MessageJob;
  }
}

/** One message the study sends a pool the person at the page plays; what they answer is the reply. */
type MessageJob = {
  type: 'message';
  node: FlowNode;
  message: Message | null;
};

function MessageScreen({ job, session, complete }: NodeProps<MessageJob>) {
  const view = useMemo(() => viewOf(job.message?.content), [job.message]);
  const [text, setText] = useState('');
  const reply = (answer: string): void => {
    session.answer(answer);
    complete();
  };

  return (
    <NodePanel>
      <h2 className={nodeStyles.title}>{readString(job.node, 'name') || job.node.id}</h2>
      {view.texts.map((line, i) => <p key={i} className={nodeStyles.body}>{line}</p>)}
      {view.fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-stone-800">
          {view.fields.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-stone-500">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {view.options.length > 0 ? (
        <div className={nodeStyles.actions}>
          {view.options.map((option) => (
            <button key={option} type="button" className={nodeStyles.primaryButton} onClick={() => reply(option)}>
              {option}
            </button>
          ))}
        </div>
      ) : (
        <>
          <textarea
            className={nodeStyles.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Your answer"
            placeholder="Your answer"
          />
          <div className={nodeStyles.actions}>
            <button type="button" className={nodeStyles.primaryButton} onClick={() => reply(text)}>
              Send
            </button>
          </div>
        </>
      )}
    </NodePanel>
  );
}

registerNode({
  type: 'message',
  match: { bpmnType: 'bpmn:Participant' },
  toJob: (node) => ({ type: 'message', node, message: null }),
  Component: MessageScreen,
});
