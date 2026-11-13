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

A timer catch event's screen is never handed its step: the walk waits for the time itself, and the screen shows the
wait. Its job gets `until`, when the wait ends (ms since the epoch); `WaitPanel` (`@runner/nodes/WaitPanel`) draws a
title, what the participant does meanwhile, and the time left. The page drops the screen when the time is up, so it
calls neither `complete` nor `abort`. A catch event that waits for no timer has no screen.

A task whose band names a pool a program answers (a model, a bot) exchanges with that pool, and a page has no one to
play it, so the study is refused. A screen that plays the pool itself says so with `playsBand: (node) => boolean` in
its registration, and the exchange then happens inside the screen. The behaverse skill's screen does so for a model,
which it asks at each trial, and for the build's own bot.

A screen is handed the Parameters wired into its step (`node.parameters`) and no other data input, so the page warns
of any other data object a step reads along a data edge. A screen that reads one itself, from the model, names it with
`reads: (node) => string[]`, the ids of those data objects. The behaverse skill's screen reads the prompt it tells a
model that takes the task.

The result a screen gives with `session.answer` is written along its step's data outputs, as the walk writes a
runner's. A screen that gives one says so with `answers: true`, and the page warns of a data output of any other
screen's step, since nothing fills it. A page holds the value for the run and saves nothing, so it also warns of a
data output kept at a `uri`.

A skill that watches the runs themselves rather than playing a step (the behaverse skill records them on its data server)
calls `registerRunObserver({ start, finish, close?, toggle? })` from `@runner/observers` in the same module: `start` is
told the study and who takes it once the checks pass, and may name the run; `finish` is told how it ended; `toggle`
puts a switch beside the runner's log.
