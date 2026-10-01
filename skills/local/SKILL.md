---
name: local
description: "The runtime behind `studyflow run --runtime local`: hosts the walk on this machine, records, and hands each element to the skill that claims it. Use when running the data-facing half of a study on a machine."
license: MIT
compatibility: "The studyflow CLI, and git for the run repository; a runner brings what it needs (the shipped ones, uv)."
metadata:
  schema: "local.moddle.yaml"
---

`src/run.ts` hosts the walk (`packages/core/src/engine`, the one engine every runtime hosts) inside the `studyflow`
CLI. It never executes an element itself: each skill's `runtimes.local` command is started once for the run, in that
skill's folder, asked which elements it takes, and then handed each as the walk reaches it (two at once when two pools, or two paths of
one pool, reach theirs together); the contract is below. How the walk
goes (messages, repeats, timers, what a re-run skips) is in [WALK.md](WALK.md). The [prov](../prov/SKILL.md) skill's
module keeps the run repository and records.

## Partial runners

A partial runner is a program in any language that claims certain elements and executes them. [`../shell/local.py`](../shell/local.py) is a short working example, written with the Python SDK beside this file ([`runner.py`](runner.py)).

This contract is Studyflow's published language for the local runtime, and the whole interface to it: the walk coordinates, a runner executes, and nothing here depends on how a runner or the tool behind it works. A runner is its skill's side of the boundary: it speaks these terms to the walk and its tool's own protocol to the tool.

**Discovery.** `studyflow run --runtime local` starts every skill's `runtimes.local` command in that skill's folder (the checkout's `skills/`, or `libexec/skills` as installed, the skills `studyflow skill add` installed, plus any `STUDYFLOW_SKILLS` directory), and any executable named `studyflow-<name>` on PATH. `--runner NAME=COMMAND` adds or replaces one for a single run. A command that is not on this machine claims nothing, and the run goes on without it.

**Protocol.** A runner is one process for the whole run. The walk speaks to it in [JSON-RPC 2.0](https://www.jsonrpc.org/specification) on its stdin and stdout, one message a line; this is version 2 of the contract. A line on stdout that is no such message goes to the run log as it is; stderr stays on the terminal. `STUDYFLOW_RUN_PID` in the environment is the walk's pid, for anything a runner leaves running to follow, and `STUDYFLOW_LOCAL` is this folder, where the SDK is.

What the walk sends:

| Method | Params | Answer |
| --- | --- | --- |
| `initialize` | `protocol` (2), `plan` (the path of `plan.json`), `run`: `dir` (the run directory) and `cache` (its `.cache/`) | `protocol`, `elements` (the ids it will run), `live` (default true). An error stops the run before its first step: what the runner lacks (a build, a device), in its own words. |
| `execute` | `element`, `values` (the run's values: each element's by its id, the state tree under `state`), and `message` when the element is a pool the runner plays, with `conversation` when that pool remembers | What it hands back (below). An error (`code` 1, or 2 when it was cancelled; `message`) fails the step; its `data` is what it had handed back by then, which is kept. |
| `message` | `element`, `message` | None (a notification): a message along a flow into an element it is running. |
| `cancel` | `element` | None: stop this hand-off, and answer its `execute` with an error. |
| `shutdown` | | `{}`, then it exits. |

What a runner sends:

| Method | Params | Answer |
| --- | --- | --- |
| `message` | `element`, `flow`, `content`, `id`?, `inReplyTo`? | None: a message along a flow of the element it is running. |
| `log` | `text`, `element`? | None: a line for the run log. |
| `prompt` | `element`, `text`, `default` | What the person at the walk's terminal typed, or `default` when there is no terminal. |

Live elements run every time and never replay. `live: false` marks them replayable, so a re-run skips or reuses them as it does the walk's own records (the python skill answers this way). End events can be claimed too, and are handed over as the walk reaches them, so a runner can fold what it started. A runner that claims nothing is shut down at once; a walk refuses a runner that speaks another `protocol`.

Hand-offs may overlap: two pools walked at once may each be in the same runner. A hand-off is cancelled when a timer at a boundary event ends its activity, or when it outlasts `--step-timeout SECONDS` (its step then fails). A runner that has not answered two seconds after `cancel` or `shutdown` has its process ended, and is started again for its next hand-off.

What a runner leaves in the run directory is committed at the next checkpoint, while `.cache/` is never committed and is removed when the run ends (`--debug` keeps it, and leaves in it the run's values after each element, `<id>.state.json`).

**What comes back.** A runner says what it binds; nothing is read off a changed copy of the values.

- `result`: the step's result, bound under its element's id, so `{Play.trials}` reads it. For a pool, it is the answer to the message. At a gateway the runner samples for, it is the bindings its conditions read.
- `values`: values later steps read, by the id each is bound under, usually a data edge's target. One bound under a declared property's id lands in that property (`state.<scope>.<name>`).
- `state`: properties it wrote, scope by scope (`{"Session": {"count": 3}}`); `_meta` is the walk's.
- `record`: what it ran with (a package version, a model digest, the request as sent). It is merged into the step's record entry, the walk's own keys standing, and is never a value later steps read.
- `durationMs`.

A runner resolves placeholders by the rule in [docs/reference.qmd](../../docs/reference.qmd#placeholders): `state` from its root, then the nearest scope outward, then an element's result by id or name.

**Messages.** A claimed element's runner does its own exchange while it runs: what it sends (`message`) goes along the flow it names, and each message along a flow into the element is passed on to it, including any that were waiting when it started. A step with no message flow of its own exchanges along the nearest enclosing sub-process's, else along its pool's. A participant with no process is a pool a runner may claim: each message sent to it is one `execute` of that participant, with the message as `message`; the `result` is the answer, and it goes back along the pool's flow to the sender, or to the sender's pool. A hand-off that fails answers null, and the record keeps the error. A pool whose actor's `memory` is `conversation` remembers: each message comes with `conversation`, `{"id", "turn"}`, one per instance of the pool asking and the number of its exchanges before this one (a failed one is none). What was said is the runner's to keep and send along; a `turn` it holds no record of means it was started again, and it fails the hand-off rather than answer without it. A conversation lasts the run. The rest of how messages travel is in [WALK.md](WALK.md#messages).

**The SDK.** [`runner.py`](runner.py) speaks all of this for a runner written in Python, which is then two functions:

```python
import os, sys
from pathlib import Path
sys.path.insert(0, os.environ.get("STUDYFLOW_LOCAL") or str(Path(__file__).resolve().parents[1] / "local"))
from runner import serve

def claims(plan):   # the ids it takes; or {"elements": [...], "live": False}
    return [eid for eid, e in plan["elements"].items() if e["attributes"].get("implementation", "").startswith("echo://")]

def execute(step):  # one hand-off: what it returns is the result, and raising fails the step
    return step.fill(step.element.get("additionalArguments") or "")

if __name__ == "__main__":
    sys.exit(serve(claims, execute))
```

`step` carries the hand-off: `id`, `element`, `plan`, `values`, `message`, `options`, `seed`, `run_dir` and `cache`; `bind(id, value)`, `write(scope, name, value)` and `note(**record)` for what goes back; `resolve(path)`, `fill(text)` and `read(text)` for placeholders; `send`, `receive` and `ask` for messages; `prompt(text, default)` for the person; `cancelled`, which a long step checks (a `receive` raises `Cancelled`). What the runner prints goes to the run log, unless it serves with `terminal=True`, for a runner a person sits at. One hand-off at a time runs on the process's main thread, and one that overlaps it on a thread of its own.

**The plan.** `plan.json` is a digest of the study, written once per run. A runner never opens the diagram.

- `study`: `id`, `name`, `seed`, `dependencies`. A runner launched as a `uv` script gets the study's dependencies installed (`uv run --with <each>`), so its own inline metadata lists only what the runner itself imports.
- `sources`: directories a boundary input may be staged from.
- `elements`, by id: the BPMN `type`, `name`, `attributes` (local names, as written), `extensions` (namespace, type, attributes, child text), `additionalArguments`, `ioSlots`, `inputs` and `outputs` (data associations with their `transformation`), `participants` (a choreography task's bands, in order; `initiatingParticipantRef` is among its attributes), `parent`, the container, and `parameters`, the `studyflow:Parameters` wired into the element, merged (present only when one is). Mappings merge key by key, and a value two of them set stops the run before it starts, since nothing drawn orders the wires. A key naming an XML attribute the element's extension type declares (its schema, inherited ones included) is not in `parameters`: it is written into that extension's `attributes`, as the text of one value, so a runner reads an `instrument` the wires set where it reads any other. Wired into a sub-process, the rest are read-only properties of it: they are in `state.<sub-process>` for the steps inside, and a runner that hands one back changed fails the step. Pool participants and message flows (`sourceRef`, `targetRef`, `messageRef`) are elements too, with the messages (`itemRef`) and item definitions (`structureRef`) they lead to. Every pool with a process is walked at once, and so is each path a split starts.
- `names`: element ids to the names a placeholder may cite (`{Play.trials}`), one element each. A name two elements share, or one that is also an id, binds nothing.
- Nothing is inferred: an attribute the diagram omits is absent, and its default is the runner's to know.
