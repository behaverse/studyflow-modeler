# Runner nodes

A node kind the runner can execute (start, end, instruction, questionnaire, task,
behaverse, choreography) is **one folder**: `src/runner/nodes/<kind>/`. Its React
component, its pure validator, and anything else it needs all live there.

Auto-discovery (`import.meta.glob('./*/index.tsx')` in [`index.ts`](./index.ts))
imports every `<kind>/index.tsx` at startup; each one self-registers via
`registerNode(...)`.

## How to add a node

1. Create `src/runner/nodes/<newKind>/index.tsx` (the component + registration).
2. Augment `JobsByType` (declared in `@/runner/jobs`) so `Job` includes your kind
   — do it with a `declare module` block inside your own file, as below.
3. Define the job type + component; put any pure validator in
   `src/runner/nodes/<newKind>/validation.ts` and import it.
4. Call `registerNode({ type, match, toJob, Component, validateNode? })`.

That's it — one new folder, no other file needs editing.

`index.tsx` holds the view: the component, its hooks, and its registration. Logic
that does not need React — reading attributes off the business object, validators,
payload building — belongs in a plain `.ts` beside it, so it stays testable in Node.

### What a component gets (`NodeProps`)

`job` (its own typed job), `session` (call `session.setVariable(name, value)` to
publish what the node collected), `log(kind, message)`, `complete()` to advance,
and `abort(reason)` to stop the run. `complete()` takes no result — nothing
downstream reads one; persist through `session.setVariable` instead.

### Validation hooks

- `validateNode(node, studyflow, manifest?)` — runs once per flow node this
  definition matches. Use this one unless you cannot.
- `validateStudyflow(studyflow, manifest?)` — runs once per studyflow, for checks
  that span nodes this definition does *not* match (only `task/` needs it, to
  check `implementation` refs wherever they appear).

### `match` shapes

- `{ extensionType: 'studyflow:MyKind' }` - match by `node.extensionType` (most specific; priority over bpmnType).
- `{ bpmnType: 'bpmn:StartEvent' }` or `{ bpmnType: ['bpmn:UserTask', 'bpmn:ServiceTask'] }` - match by `node.type`.
- `{ fallback: 'task' }` - catch any unmatched `bpmn:*Task`. Only `task/` uses this pattern.

### Example: a "wait" node that pauses for N seconds

```tsx
// src/runner/nodes/wait/index.tsx
import { useEffect } from 'react';
import { getAttribute } from '@/core/element';
import type { FlowNode } from '@/runner/flow';
import type { NodeProps } from '@/runner/nodes/types';
import { registerNode } from '@/runner/nodes/registry';
import { nodeStyles } from '@/runner/nodes/styles';

declare module '@/runner/jobs' {
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

## The shared pieces

Everything below sits directly in `src/runner/nodes/`, beside the per-kind folders:

- [`index.ts`](./index.ts) - public API (`findByFlowNode`, `findByType`, `validate`) + the auto-discovery glob. `validate` is async because it fetches whatever context the registered kinds validate against (today, behaverse's Unity manifest), so callers never handle one.
- [`registry.ts`](./registry.ts) - holds the mutable `nodes[]` and `registerNode`. It is a separate file so a node module can import `registerNode` without re-triggering the glob, which would be a circular import.
- `types.ts` - `NodeProps`, `NodeMatcher`, `NodeDefinition` - the whole plug-in contract.
- `implementationRef.ts` - reads and validates BPMN's `implementation` attribute (`python://pkg.fn@1.2`) and its `additionalArguments`; used by `task/`.
- `NodePanel.tsx` - frames the node's component; `Runner.tsx` looks up which component the current job's `type` renders.
- `styles.ts` - the shared `nodeStyles` every kind uses.
