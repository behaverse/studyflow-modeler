# Runner nodes

An element runner is one folder, `src/nodes/<kind>/`, or `skills/<name>/browser/` for a skill's own. Every `index.tsx` there is imported at startup and registers itself; no other file changes.

1. Create `index.tsx` with the component and its registration.
2. Declare the job type by augmenting `JobsByType` from `@runner/jobs`.
3. Call `registerNode({ type, match, toJob, Component, validateNode? })`.

`match` is `{ extensionType: 'studyflow:MyKind' }` (most specific), `{ bpmnType: 'bpmn:StartEvent' }` (one or a list), or `{ fallback: 'task' }`. The component gets its `job`, `session.setVariable(name, value)` to publish what it collected, `complete()` to advance, and `abort(reason)` to stop.

```tsx
// src/nodes/wait/index.tsx
import { useEffect } from 'react';
import { getAttribute } from '@core/element';
import type { FlowNode } from '@runner/flow';
import type { NodeProps } from '@runner/nodes/types';
import { registerNode } from '@runner/nodes/registry';

declare module '@runner/jobs' {
  interface JobsByType { wait: WaitJob; }
}

type WaitJob = { type: 'wait'; node: FlowNode; seconds: number };

function Wait({ job, complete }: NodeProps<WaitJob>) {
  useEffect(() => {
    const t = setTimeout(complete, job.seconds * 1000);
    return () => clearTimeout(t);
  }, [job.seconds, complete]);
  return <p>Waiting {job.seconds}s...</p>;
}

registerNode({
  type: 'wait',
  match: { extensionType: 'studyflow:Wait' },
  toJob: (node) => ({ type: 'wait', node, seconds: Number(getAttribute(node.businessObject, 'seconds')) || 0 }),
  Component: Wait,
});
```
