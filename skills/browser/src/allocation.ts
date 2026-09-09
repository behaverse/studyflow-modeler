import { readString, type FlowNode } from '@runner/flow';
import type { ValidationIssue } from '@runner/nodes/types';

/* The only allocation a stateless browser session can honour; everything else is warned about, not performed (docs/guides/randomization.qmd). */
const HONORED_ALGORITHM = 'simple';

/** `1:1`, `1:1:1`, ... : every arm the same size, which an equal-chance draw delivers in expectation. */
function isEqualRatio(ratio: string): boolean {
  const parts = ratio.split(':').map((part) => part.trim());
  return parts.every((part) => part !== '' && part === parts[0]);
}

/** What this node asks for that the equal-chance draw will not deliver, phrased for the message. */
function unhonored(node: FlowNode): string[] {
  const asked: string[] = [];

  const algorithm = readString(node, 'algorithm');
  if (algorithm && algorithm !== HONORED_ALGORITHM) asked.push(`${algorithm} assignment`);

  const ratio = readString(node, 'allocationRatio');
  if (ratio && !isEqualRatio(ratio)) asked.push(`a ${ratio} allocation ratio`);

  const stratifyBy = readString(node, 'stratifyBy');
  if (stratifyBy) asked.push(`stratification by '${stratifyBy}'`);

  return asked;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Warns when a gateway's allocation attributes describe an assignment this runner will not perform. */
export function validateAllocation(node: FlowNode): ValidationIssue[] {
  const asked = unhonored(node);
  if (asked.length === 0) return [];

  const label = readString(node, 'bpmn:name') ?? node.id;
  return [{
    nodeId: node.id,
    severity: 'warning',
    message: `'${label}' specifies ${list(asked)}, which this runner does not apply: it draws one of `
      + `the ${node.outgoing.length} outgoing branches with equal probability. Balancing allocation `
      + 'across a cohort needs an allocator that remembers earlier participants, and a browser session '
      + 'sees one participant at a time. Allocate outside the diagram and pass the arm in as a study '
      + 'property, or drop the attribute so the file matches what runs.',
  }];
}
