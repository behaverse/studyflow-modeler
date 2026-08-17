# @behaverse/studyflow-runner

The browser runner: it takes a studyflow and runs it with a participant in front of it — consent, instructions, questionnaires, cognitive tasks, Behaverse (Unity) tasks — one screen at a time. Served at `/run/`.

It is one of two executors. This one drives the participant-facing half of the notation; the [Python runner](../runner-py/) drives the analysis half, where steps are bound to software. They read the same files.

## Contract

- It owns **what a participant sees**. Parsing, validation of the document itself, and the type catalog come from [`@behaverse/studyflow-core`](../core/).
- It never imports from [`packages/modeler`](../modeler/) — ESLint refuses it. It receives a diagram over the wire (a URL) or through `localStorage` (the modeler's hand-off id), never by import.
- **One token, one step at a time.** The walk is an async generator (`src/session.ts`): yield a job, wait for that screen to resolve, then ask which sequence flow is next. No fan-out, no queue, no persisted run state.
- **A node kind is a folder.** `src/nodes/<kind>/index.tsx` self-registers at startup and needs no other file edited; an element no kind matches warns twice (pre-flight and on arrival) and is skipped rather than failing the run. The folder list *is* the set of screens this runner has.
- **Condition expressions are JavaScript here**, Python in the Python runner. BPMN's per-expression `language` names the other one, and each runner refuses what it cannot evaluate instead of guessing.
- **It says what it will not do before it starts.** The pre-flight reports empty instruction content, unknown Behaverse tasks, unresolvable `implementation` references, and `RandomGateway` allocation attributes it cannot honor (`src/allocation.ts`): a browser session sees one participant, so cohort-level allocation is named as a gap rather than approximated.
- Event recording to `data.behaverse.org` is **opt-in** (`src/dataServer.ts`); with it off, a session leaves nothing behind on a server.

## Where things are

| File or folder | What it holds |
| --- | --- |
| `src/Runner.tsx` `src/index.tsx` | the shell: resolve the source, load the studyflow, render the current job |
| `src/source.ts` | what `?diagram=` means — a shipped demo's name, a URL to fetch, or a hand-off id |
| `src/studyflow.ts` `src/flow.ts` | the parsed document, and reading a flow node off it |
| `src/session.ts` | the walk: one token, `advance()` per step, the scope chain, the diagnostics |
| `src/scope.ts` | `bpmn:Property` frames — a read resolves outward, a write lands on the innermost frame that declares the name |
| `src/branching.ts` | `mulberry32`, the seeded PRNG, and condition evaluation |
| `src/allocation.ts` | the pre-flight check over `RandomGateway` allocation attributes |
| `src/jobs.ts` | `JobsByType`, the open union each node kind augments |
| `src/dataServer.ts` | opt-in session and event recording |
| `src/nodes/` | one folder per node kind, plus the registry — see [`src/nodes/README.md`](src/nodes/README.md) |

## Running one

```bash
npm run dev     # from the repo root: http://localhost:5173/run/
```

`?diagram=` names what to run; every other query parameter binds a value into the study, which is how one diagram is parameterized per participant.

```
run?diagram=behaverse&task=BCS
run?diagram=https://example.org/study.studyflow.png&seed=42
```

The full parameter table is in [Command line and URLs](../../docs/reference/cli.qmd).

## More

- [Browser runner guide](../../docs/run/participants.qmd) — a session, end to end.
- [Add a node kind](../../docs/develop/runner-nodes.qmd) — the plug-in contract, and one folder end to end. The contract itself is also documented beside the code, in [`src/nodes/README.md`](src/nodes/README.md).
- [Execution](../../docs/run/execution.qmd) — which elements each executor actually runs, seeds and determinism, and what is not executed today.
- [LLM and bot participants](../../docs/design/agents.qmd) — running a study with a model in the participant's seat.
- [Architecture](../../docs/develop/architecture.qmd) — how this app sits beside the other three.
