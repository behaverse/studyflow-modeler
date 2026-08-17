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

| Parameter | Value | Effect |
| --- | --- | --- |
| `diagram` | a shipped demo's name (`behaverse`) | runs that demo |
| `diagram` | a URL — anything with a scheme, a slash, or a studyflow extension | fetched, then run |
| `diagram` | a hand-off id (a bare 8-character uuid slice) | runs what the modeler just handed over; expires after an hour |
| `seed` | an integer | binds the study's `seed`, fixing the gateway draws |
| any other name | text, converted to the declared type | binds a `Parameters` entry, a `bpmn:Property`, or a field of the study, and substitutes wherever `${name}` is written. An undeclared name still binds, and is logged as undeclared. |
| — | a `${name}` nothing binds | stops the run, naming it |

## The node kinds

| Folder under `src/nodes/` | Claims | What the participant sees |
| --- | --- | --- |
| `start/` | `bpmn:StartEvent` | the consent form, or a welcome and a *Begin* button |
| `end/` | `bpmn:EndEvent` | the completion code and the redirect countdown |
| `instruction/` | `cognitive:Instruction` | the `content` text, verbatim |
| `questionnaire/` | `cognitive:Questionnaire` | a built-in item set, or a free-text box |
| `behaverse/` | `cognitive:BehaverseTask` | the Behaverse Unity build in a frame |
| `choreography/` | `bpmn:ChoreographyTask` | the two parties, and which one initiates |
| `task/` | any task no folder above claimed | the step's name, any declared call, and *Continue* |

**Drawable is not runnable.** Declaring a type in a schema gives it a palette entry, inspector fields, and round-tripping the moment the schema loads. It does not give it a screen here: matching happens against the folders above, most specific first — applied type, then BPMN type, then the `task/` fallback — and an element nothing claims warns twice (pre-flight, and again on arrival) and is stepped past. Gateways need no folder; the session picks their branch itself.

Two things a schema *can* say change a run with no node module: a type whose branching is declared `random` is drawn from the seeded generator, and one declared `model` stops the run rather than guessing.

Validation runs before the first screen, and an issue's `severity` decides the outcome: `error` (the default) blocks the run and lists every problem beside its node id, while `warning` is logged and the run proceeds — for a study that is still deliverable but probably not what the author meant. Write the message as an instruction, naming the attribute to fix and the value to put in it.

The registration contract itself — `registerNode`, the matcher shapes, what a component is handed, and one new kind end to end — is documented beside the code in [`src/nodes/README.md`](src/nodes/README.md).

## More

- [Specification](../../docs/specification.qmd) — the walk, scopes, conditions, seeds, and which elements each executor actually runs.
- [Architecture](../../README.md#architecture-in-short) — how this app sits beside the other three.
