import type { FlowNode } from '@/runner/models/flow';
import type { NodeProps } from '@/runner/models/nodes/types';
import { NodePanel } from '@/runner/views/nodes/NodePanel';
import { readString } from '@/runner/models/nodes/readAttribute';
import { validateInstruction } from '@/runner/models/nodes/instruction/validation';
import { nodeStyles } from '@/runner/infra/nodes/styles';
import { registerNode } from '@/runner/controllers/nodes/registry';

declare module '@/runner/models/jobs' {
  interface JobsByType {
    instruction: InstructionJob;
  }
}

type InstructionJob = {
  type: 'instruction';
  node: FlowNode;
  content: string;
};

function Instruction({ job, complete }: NodeProps<InstructionJob>) {
  const title = job.node.businessObject?.name || 'Instruction';
  const content = job.content || '(no content)';

  return (
    <NodePanel>
      <h2 className={nodeStyles.title}>{title}</h2>
      <div className={nodeStyles.body}>{content}</div>
      <div className={nodeStyles.actions}>
        <button type="button" className={nodeStyles.primaryButton} onClick={() => complete()}>
          Continue
        </button>
      </div>
    </NodePanel>
  );
}

registerNode({
  type: 'instruction',
  match: { extensionType: 'cognitive:Instruction' },
  toJob: (node) => ({ type: 'instruction', node, content: readString(node, 'content') ?? '' }),
  Component: Instruction,
  validateNode: validateInstruction,
});
