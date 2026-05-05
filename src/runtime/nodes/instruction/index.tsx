import { getProperty } from '@/modeler/extensions/resolve';
import type { Process, FlowNode } from '../../types';
import type { ValidationIssue } from '../behaverse/types';
import type { NodeProps } from '../types';
import { nodeStyles } from '../styles';
import { registerNode } from '../registry';

declare module '@/runtime/types' {
  interface JobsByKind {
    instruction: InstructionJob;
  }
}

export type InstructionJob = {
  kind: 'instruction';
  node: FlowNode;
  content: string;
};

export function instructionToJob(node: FlowNode): InstructionJob {
  const content = (getProperty(node.businessObject, 'content') as string) || '';
  return { kind: 'instruction', node, content };
}

export function Instruction({ job, complete }: NodeProps<InstructionJob>) {
  const title = job.node.businessObject?.name || 'Instruction';
  const content = job.content || '(no content)';

  return (
    <div className={nodeStyles.card}>
      <div className={nodeStyles.panel}>
        <h2 className={nodeStyles.title}>{title}</h2>
        <div className={nodeStyles.body}>{content}</div>
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

export function validate(process: Process): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of process.nodes.values()) {
    if (node.appliedType !== 'studyflow:Instruction') continue;
    const content = (getProperty(node.businessObject, 'content') as string) || '';
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
  kind: 'instruction',
  match: { appliedType: 'studyflow:Instruction' },
  toJob: instructionToJob,
  Component: Instruction,
  validate,
});
