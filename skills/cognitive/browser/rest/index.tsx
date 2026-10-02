import { readString, type FlowNode } from '@runner/flow';
import type { NodeProps } from '@runner/nodes/types';
import { WaitPanel, type Waiting } from '@runner/nodes/WaitPanel';
import { nodeStyles } from '@runner/nodes/styles';
import { registerNode } from '@runner/nodes/registry';

declare module '@runner/jobs' {
  interface JobsByType {
    rest: RestJob;
  }
}

/** A rest, shown while the walk waits for its timer. */
type RestJob = Waiting & {
  type: 'rest';
  node: FlowNode;
  eyes: string;
};

/** How the participant rests, by the rest's `eyes`. */
const EYES: Record<string, string> = {
  open: 'Rest with your eyes open, looking at the screen.',
  closed: 'Close your eyes and rest.',
  alternating: 'Rest, with your eyes open and closed by turns.',
};

function Rest({ job }: NodeProps<RestJob>) {
  return (
    <WaitPanel title={readString(job.node, 'name') || 'Rest'} until={job.until}>
      <p className={nodeStyles.body}>{EYES[job.eyes] ?? EYES.open}</p>
      <p className={nodeStyles.subtitle}>The study goes on by itself when the time is up.</p>
    </WaitPanel>
  );
}

registerNode({
  type: 'rest',
  match: { extensionType: 'cognitive:Rest' },
  toJob: (node) => ({ type: 'rest', node, eyes: readString(node, 'eyes') ?? 'open' }),
  Component: Rest,
});
