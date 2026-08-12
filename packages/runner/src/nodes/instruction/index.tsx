import { readString, type FlowNode } from '@runner/flow';
import type { NodeProps } from '@runner/nodes/types';
import { NodePanel } from '@runner/nodes/NodePanel';
import { nodeStyles } from '@runner/nodes/styles';
import { registerNode } from '@runner/nodes/registry';
import { validateInstruction } from '@runner/nodes/instruction/validation';

declare module '@runner/jobs' {
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
