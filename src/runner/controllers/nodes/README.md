# Runner nodes

A node kind the runner can execute (start, end, instruction, questionnaire, task,
behaverse) is split across the per-app MVC buckets: its React component lives under
`src/runner/views/nodes/<kind>/index.tsx`, its pure validator under
`src/runner/models/nodes/<kind>/validation.ts`, and the shared registry/types/styles
in `controllers/nodes/`, `models/nodes/`, and `infra/nodes/` respectively.
Auto-discovery (`import.meta.glob('../../views/nodes/*/index.tsx')` in
[`index.ts`](./index.ts)) imports every `views/nodes/<kind>/index.tsx` at startup;
each one self-registers via `registerNode(...)`.

## How to add a node

1. Create `src/runner/views/nodes/<newKind>/index.tsx` (the component + registration).
2. Augment `JobsByType` (in `@/runner/models/types`) so `Job` includes your kind.
3. Define the job type + component; put any pure validator in
   `src/runner/models/nodes/<newKind>/validation.ts` and import it.
4. Call `registerNode({ type, match, toJob, Component, validateNode? })`.

That's it; no other file needs editing.

### `match` shapes

- `{ extensionType: 'studyflow:MyKind' }` - match by `node.extensionType` (most specific; priority over bpmnType).
- `{ bpmnType: 'bpmn:StartEvent' }` or `{ bpmnType: ['bpmn:UserTask', 'bpmn:ServiceTask'] }` - match by `node.type`.
- `{ fallback: 'task' }` - catch any unmatched `bpmn:*Task`. Only `task/` uses this pattern.

### Example: a "wait" node that pauses for N seconds

```tsx
// src/runner/views/nodes/wait/index.tsx
import { useEffect } from 'react';
import { getAttribute } from '@/core/extensions';
import type { FlowNode } from '@/runner/models/flow';
import type { NodeProps } from '@/runner/models/nodes/types';
import { registerNode } from '@/runner/controllers/nodes/registry';
import { nodeStyles } from '@/runner/infra/nodes/styles';

declare module '@/runner/models/jobs' {
  interface JobsByType {
    wait: WaitJob;
  }
}

type WaitJob = {
  type: 'wait';
  node: FlowNode;
  seconds: number;
};

function Wait({ job, complete }: NodeProps<WaitJob>) {
  useEffect(() => {
    const t = setTimeout(complete, job.seconds * 1000);
    return () => clearTimeout(t);
  }, [job.seconds, complete]);
  return <div className={nodeStyles.card}>Waiting {job.seconds}s...</div>;
}

registerNode({
  type: 'wait',
  match: { extensionType: 'studyflow:Wait' },
  toJob: (node) => ({
    type: 'wait',
    node,
    seconds: Number(getAttribute(node.businessObject, 'seconds')) || 0,
  }),
  Component: Wait,
});
```

That's the whole node. The registry picks it up automatically.

## Where the pieces live (per-app MVC)

- `controllers/nodes/` (this folder):
  - [`index.ts`](./index.ts) - public API (`findByFlowNode`, `findByType`, `validate`) + the auto-discovery glob.
  - [`registry.ts`](./registry.ts) - holds the mutable `nodes[]` and `registerNode`. Lives in its own file so node modules can import `registerNode` without re-triggering the glob (which would cause a circular import).
- `views/nodes/` - `<kind>/index.tsx` (one folder per kind), `NodeRenderer.tsx` (looks up the component for the current job's `type`), `NodePanel.tsx`.
- `models/nodes/` - `types.ts` (`NodeProps`, `NodeMatcher`, `NodeDefinition`), shared attribute readers, and `<kind>/validation.ts` (pure validators).
- `infra/nodes/` - `styles.ts` (shared `nodeStyles` used by every kind).
