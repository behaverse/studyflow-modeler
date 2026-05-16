# Runner nodes

Each subfolder is one node kind the runner can execute (start, end, instruction,
questionnaire, task, behaverse). Adding a new kind = creating one new folder.
Auto-discovery (`import.meta.glob` in [`index.ts`](./index.ts)) imports every
`<kind>/index.tsx` at startup; each one self-registers via `registerNode(...)`.

## How to add a node

1. Create `src/runner/nodes/<newKind>/index.tsx`.
2. Augment `JobsByKind` so `Job` includes your kind.
3. Define the job type + component + optional validator.
4. Call `registerNode({ kind, match, toJob, Component, validate? })`.

That's it; no other file needs editing.

### `match` shapes

- `{ extensionType: 'studyflow:MyKind' }` - match by `node.extensionType` (most specific; priority over bpmnType).
- `{ bpmnType: 'bpmn:StartEvent' }` or `{ bpmnType: ['bpmn:UserTask', 'bpmn:ServiceTask'] }` - match by `node.type`.
- `{ fallback: 'task' }` - catch any unmatched `bpmn:*Task`. Only `task/` uses this pattern.

### Example: a "wait" node that pauses for N seconds

```tsx
// src/runner/nodes/wait/index.tsx
import { useEffect } from 'react';
import { getAttribute } from '@/lib/core/extensions';
import type { FlowNode } from '@/lib/core/flow';
import type { NodeProps } from '../types';
import { registerNode } from '../registry';
import { nodeStyles } from '../styles';

declare module '@/runner/types' {
  interface JobsByKind {
    wait: WaitJob;
  }
}

type WaitJob = {
  kind: 'wait';
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
  kind: 'wait',
  match: { extensionType: 'studyflow:Wait' },
  toJob: (node) => ({
    kind: 'wait',
    node,
    seconds: Number(getAttribute(node.businessObject, 'seconds')) || 0,
  }),
  Component: Wait,
});
```

That's the whole node. The registry picks it up automatically.

## Files in this folder

- `<kind>/` - one folder per node kind.
- [`index.ts`](./index.ts) - public API (`findByFlowNode`, `findByKind`, `validate`) + the auto-discovery glob.
- [`registry.ts`](./registry.ts) - holds the mutable `nodes[]` and `registerNode`. Lives in its own file so node modules can import `registerNode` without re-triggering the glob (which would cause a circular import).
- [`types.ts`](./types.ts) - `NodeProps`, `NodeMatcher`, `NodeDefinition`, plus shared attribute readers.
- [`NodeRenderer.tsx`](./NodeRenderer.tsx) - looks up the component for the current job's `kind` and renders it.
- [`styles.ts`](./styles.ts) - shared `nodeStyles` used by every kind.
