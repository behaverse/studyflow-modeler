import type { FlowNode } from '@/lib/core/flow';
import type { NodeProps } from '@/runner/nodes/types';
import { NodePanel } from '../NodePanel';
import { readString } from '../readAttribute';
import { nodeStyles } from '../styles';
import { registerNode } from '../registry';

declare module '@/runner/types' {
  interface JobsByType {
    choreography: ChoreographyJob;
  }
}

type ChoreographyJob = {
  type: 'choreography';
  node: FlowNode;
  topParticipant: string;
  bottomParticipant: string;
  /** 'top' | 'bottom'; which participant initiates the interaction. */
  initiator: string;
};

/** One participant row; the initiator is highlighted and labelled. */
function ParticipantRow({ name, initiates }: { name: string; initiates: boolean }) {
  return (
    <div
      className={`flex items-center justify-between rounded px-3 py-2 border ${
        initiates ? 'bg-white border-stone-400' : 'bg-stone-100 border-stone-200'
      }`}
    >
      <span className="font-medium text-stone-900">{name}</span>
      {initiates && <span className="text-xs uppercase tracking-wide text-stone-500">initiates</span>}
    </div>
  );
}

function Choreography({ job, complete }: NodeProps<ChoreographyJob>) {
  const title = job.node.businessObject?.name || 'Interaction';
  const documentation = job.node.businessObject?.documentation?.[0]?.text || '';

  return (
    <NodePanel>
      <h2 className={nodeStyles.title}>{title}</h2>
      <span className={nodeStyles.subtitle}>
        Interaction between {job.topParticipant} and {job.bottomParticipant}
      </span>
      <div className="flex flex-col gap-2" data-testid="choreography-participants">
        <ParticipantRow name={job.topParticipant} initiates={job.initiator !== 'bottom'} />
        <ParticipantRow name={job.bottomParticipant} initiates={job.initiator === 'bottom'} />
      </div>
      {documentation && <div className={nodeStyles.body}>{documentation}</div>}
      <div className={nodeStyles.actions}>
        <button type="button" className={nodeStyles.primaryButton} onClick={() => complete()}>
          Continue
        </button>
      </div>
    </NodePanel>
  );
}

registerNode({
  type: 'choreography',
  match: { bpmnType: 'bpmn:ChoreographyTask' },
  toJob: (node) => ({
    type: 'choreography',
    node,
    topParticipant: readString(node, 'topParticipant') ?? 'Participant A',
    bottomParticipant: readString(node, 'bottomParticipant') ?? 'Participant B',
    initiator: readString(node, 'initiator') ?? 'top',
  }),
  Component: Choreography,
});
