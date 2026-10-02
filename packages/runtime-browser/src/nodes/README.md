# Runner nodes

An element runner is one folder, `src/nodes/<kind>/`, or `skills/<name>/browser/` for a skill's own. Every `index.tsx` there is imported at startup and registers itself; no other file changes.

1. Create `index.tsx` with the component and its registration.
2. Declare the job type by augmenting `JobsByType` from `@runner/jobs`.
3. Call `registerNode({ type, match, toJob, Component, validateNode? })`.

`match` is `{ scheme: 'jspsych' }` (the step's `implementation` names it, whatever its type), `{ extensionType: 'studyflow:MyKind' }`, `{ bpmnType: 'bpmn:StartEvent' }` (one or a list), or `{ fallback: 'task' }`. `toJob` gets the step as a `FlowNode`: its `element` as the study model holds it, the `model` it is in (for what it refers to by id), and the `parameters` wired into it; `attributeOf(node, name)` and `readString(node, name)` read an attribute, its schema entry's when the element does not hold it. The component gets its `job`, `session.answer(value)` to give the step its result (`{Step.field}` reads it), `session.setVariable(name, value)` to publish what it collected, `complete()` to advance, and `abort(reason)` to stop.

```tsx
// src/nodes/wait/index.tsx
import { useEffect } from 'react';
import { attributeOf, type FlowNode } from '@runner/flow';
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
  toJob: (node) => ({ type: 'wait', node, seconds: Number(attributeOf(node, 'seconds')) || 0 }),
  Component: Wait,
});
```

A skill that watches the runs themselves rather than playing a step (the behaverse skill records them on its data server)
calls `registerRunObserver({ start, finish, close?, toggle? })` from `@runner/observers` in the same module: `start` is
told the study and who takes it once the checks pass, and may name the run; `finish` is told how it ended; `toggle`
puts a switch beside the runner's log.
