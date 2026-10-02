import { readString, type FlowNode } from '@runner/flow';
import type { NodeProps } from '@runner/nodes/types';
import { WaitPanel, type Waiting } from '@runner/nodes/WaitPanel';
import { nodeStyles } from '@runner/nodes/styles';
import { registerNode } from '@runner/nodes/registry';

declare module '@runner/jobs' {
  interface JobsByType {
    timer: TimerJob;
  }
}

/** A timer event, shown while the walk waits for its time. */
type TimerJob = Waiting & {
  type: 'timer';
  node: FlowNode;
};

function Timer({ job }: NodeProps<TimerJob>) {
  return (
    <WaitPanel title={readString(job.node, 'name') || 'Please wait'} until={job.until}>
      <p className={nodeStyles.subtitle}>The study goes on by itself when the time is up.</p>
    </WaitPanel>
  );
}

registerNode({
  type: 'timer',
  match: { bpmnType: 'bpmn:IntermediateCatchEvent' },
  toJob: (node) => ({ type: 'timer', node }),
  Component: Timer,
});
