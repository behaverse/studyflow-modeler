import type { FlowNode } from '@/lib/core/flow';
import type { Study } from '@/runner/study';
import type { NodeProps, ValidationIssue } from '@/runner/nodes/types';
import { NodePanel } from '../NodePanel';
import { readString } from '../readAttribute';
import { nodeStyles } from '../styles';
import { registerNode } from '../registry';

declare module '@/runner/types' {
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

function validateInstructions(study: Study): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of study.flowNodes.values()) {
    if (node.extensionType !== 'cognitive:Instruction') continue;
    const content = readString(node, 'content') ?? '';
    if (!content.trim()) {
      issues.push({
        nodeId: node.id,
        message: `Instruction '${node.id}' has no content.`,
      });
    }
  }
  return issues;
}

registerNode({
  type: 'instruction',
  match: { extensionType: 'cognitive:Instruction' },
  toJob: (node) => ({ type: 'instruction', node, content: readString(node, 'content') ?? '' }),
  Component: Instruction,
  validate: validateInstructions,
});
