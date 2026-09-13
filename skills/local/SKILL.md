---
name: local
description: "The reference runner behind `studyflow run --runtime local`: walks the diagram, evaluates values, records, and hands each element to the skill that claims it. Use when running the data-facing half of a study on a machine."
license: MIT
compatibility: "Python 3.10+ through uv."
metadata:
  schema: "local.moddle.yaml"
---

`run.py` is the walk. It never executes an element itself: each skill's `runtimes.local`
command is asked for its claims and then handed one element at a time (`<plan.json> --element <id> --cache <dir>`),
run in that skill's folder; the contract is below.
The [prov](../prov/SKILL.md) skill's module is loaded in-process for the run repository and records.

## Partial runners

A partial runner is a program in any language that claims certain elements and executes them. [`../reachy/local.py`](../reachy/local.py) is a working example; [`../prov/prov.py`](../prov/prov.py) is the records module the walk loads in-process.

**Discovery.** `studyflow run --runtime local` runs every skill's `runtimes.local` command in that skill's folder (the checkout's `skills/`, or `libexec/skills` as installed, plus any `STUDYFLOW_SKILLS` directory), and any executable named `studyflow-<name>` on PATH.

**Protocol.**

1. `<plan.json> --claims`: print the ids of the elements you will run, as JSON on stdout. A plain array marks them live: they run every time and never replay. `{"elements": [...], "live": false}` marks them replayable, so a re-run skips or reuses them as it does the walk's own records (the python skill answers this way). End events can be claimed too, and are handed over as the walk reaches them, so a runner can fold what it started.
2. `<plan.json> --element <id> --cache <dir>`, once per claimed element. `STUDYFLOW_RUN_PID` in the environment is the walk's pid, for anything a runner leaves running to follow.
3. The cache holds one file per call, `<element_id>.state.json`. It starts as `{state}`; the runner updates it with the result, so it becomes the same state plus `result`, `durationMs`, and on failure `error` with a non-zero exit. Stdout goes to the run log; stdin and stderr stay on the terminal.

Every call also carries the run's `--sim` and `--auto` flags when it has them, so a runner must accept both, even to ignore them.

What comes back: `result`, `durationMs` and `error` are recorded. Any other top-level key whose value changed becomes a value the next steps read, so a runner binds its own result by writing it under its element id (`{Play.trials}` then reads it). Scopes under `state` that changed are merged, `_meta` excepted. At a gateway the runner samples for, `result` is the bindings its conditions read; for a catch event, `result` is bound under the event's id.

**The plan.** `plan.json` is a digest of the study, written once per run. A runner never opens the diagram.

- `study`: `id`, `name`, `seed`, `dependencies`. A runner launched as a `uv` script gets the study's dependencies installed (`uv run --with <each>`), so its own inline metadata lists only what the runner itself imports.
- `sources`: directories a boundary input may be staged from.
- `elements`, by id: the BPMN `type`, `name`, `attributes` (local names, as written), `extensions` (namespace, type, attributes, child text), `additionalArguments`, `ioSlots`, `inputs` and `outputs` (data associations with their `transformation`), `participants` (a choreography task's bands, in order; `initiatingParticipantRef` is among its attributes), and `parent`, the container. Pool participants and message flows (`sourceRef`, `targetRef`, `messageRef`) are elements too, with the messages (`itemRef`) and item definitions (`structureRef`) they lead to. Every pool with a process is walked at once; an element with incoming message flows is handed over only once their sources have been reached.
- `names`: element ids to the names a placeholder may cite (`{Play.trials}`), one element each. A name two elements share, or one that is also an id, binds nothing.
- Nothing is inferred: an attribute the diagram omits is absent, and its default is the runner's to know.

**State.** The state file carries the study's state tree under `state` (`state.<scope>.<property>`, `state._meta`). A runner resolves placeholders by the rule in [docs/reference.qmd](../../docs/reference.qmd#placeholders) (`state` from its root, then the nearest scope outward, then an element's result by id or name), writes a data edge's value into its target property under `state`, and the walk adopts the scopes that changed.
