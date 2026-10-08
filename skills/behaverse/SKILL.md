---
name: behaverse
description: "The Behaverse assessment battery: its tasks and BDM datasets, and the runner that plays the tasks on the Behaverse Unity WebGL build, in the browser runner's page or in a window of its own. A person takes a task, or a model on its band, the build's random bot, or whoever its message flows reach. Use when a study includes Behaverse assessment tasks."
license: MIT
compatibility: "Browser runtime, or the local runtime with uv; both need a Behaverse WebGL build (UNITY_BUILD_PATH)."
metadata:
  schemes: "behaverse"                  # the <scheme>:// references its runners execute
  schema: "behaverse.moddle.yaml"
  runtimes:
    browser: "browser/index.tsx"
    local: "uv run --script local.py"
  modeler: "modeler.ts"
---

The vocabulary is `behaverse.moddle.yaml` (`behaverse:Task`, `behaverse:BDMDataset`, and the literals it adds to cognitive's software list and the core's dataset formats and message structures); the runner executes `behaverse:Task`. A task's
`instrument` is which task of the battery runs (`NB`; the wire's `scene`, BDM's `instrument_id`), and its `timeline` the
one timeline that runs: one the build ships for the instrument, or one defined under `Timelines` in the Parameters
wired into it. Both are attributes of the task, and a wired Parameters key of the same name sets either. The task's
GameConfig is the rest of those Parameters, merged, which the runtime hands over as the task's `parameters` (`Blocks`,
`Timelines` definitions), less a `Bot:` entry for how the build's bot plays. A task naming no timeline has no trials
to run, and is refused; so is an empty `Timelines` entry, which defines nothing. Its message
flows carry `behaverse:Trial` out of the task and `behaverse:Response` back into it (the `structureRef`
of an `ItemDefinition`, reached through the flow's `messageRef` and the message's `itemRef`); a flow naming another
structure is some other skill's exchange, a flow naming none is taken for either, and two partners with no message
named is an error rather than a guess. The task's trial records go to the `uri` its data output names, else
`<id>.events.jsonl` in the run. Several tasks may deposit into one drawn dataset, and a task in a loop plays once
per pass: the first write of a run starts that file, the rest append, and the next run starts it again.
Each line carries the runner's own `context` beside what the build recorded:
`subject`, the instance the nearest repeating scope around the task is on (`state._meta.instance`, 1-based): an
enclosing activity, else the pool of several instances (`participantMultiplicity`) whose process holds the task. So
every task of one subject stamps the same number, whichever subjects left before reaching it, and a cohort of four
instances numbers them 1 to 4 (with no repeating scope around it, the task's own visit count, which the study's state keeps),
and `state`, the properties in scope at the hand-off (an enclosing sub-process's `arm`, say), so the trials group
by subject and by condition without joining anything in.

Who answers is what the diagram draws, never a `Bot:` entry, which only says how the build's bot plays. In a local
run a task with message flows — its own, or the nearest enclosing sub-process's, which is where BPMN can draw them
when that sub-process is collapsed — sends each awaiting trial as the build describes it (`TrialIndex`, its `Stimulus`,
`ResponseOptions`, `MaxResponseTime`, the instrument as `Scene`, and a `Screenshot` when the build takes one), and with
it the task's data inputs (the `agentic:Prompt` wired into it, above all), along the one out of it, and injects the answer that comes back naming one of the trial's options; any other answer, or none in time, is a miss, and nothing stands in for it.
The browser runner plays a person, a model on the task's band (its `implementation` names it), or the build's random
bot (a `software` taker whose `implementation` is `behaverse://bot`); any other taker answers along message flows, locally.
When the task answers along message flows, its `failedTrialRate` is kept with its result: the share of the scored trials the build presented that it recorded no
valid response for. The scored trials are those of the blocks named in `ScoredBlocks`, a list of block names at the
top of the Parameters wired into the task (`ScoredBlocks: [XCIT_RE_02_Test_A, XCIT_RE_02_Test_B]`), which the runner
reads and never sends to the build; without it, every block counts, tutorials and practice included. A name the
task's inline timeline (one the Parameters define under `Timelines`) does not play stops the task before it starts.
The build is the authority: where it writes one `<TASK>.TrialEnd` record per trial it presents (`RE.TrialEnd`, with
`result.isAnswered` and `trialContext.condition`), those records say which trials were presented and answered, and a
`BurnIn` trial (the N-back's first digits of a block, sent so the responder sees every digit) is never scored;
otherwise a trial is one it started or took a response in, answered by a `Click` or a `TrialEnd` with a
`responseTime`, and a trial that takes none (the burn-in, whose every stream the build records as `BurnInDisabled`)
is not counted. Either way an answer injected too late for the trial's window counts as a miss however well it
named an option, and a build that reports no scored trial reports no failure. It is data, not policy:
a study that wants a bad run to leave the task draws a conditional boundary event on it
(`{Play.failedTrialRate} > 0.2`), and the walk goes on from there. A task played any other way (by a person, by the
build's own bot, or in the browser runner) carries no `failedTrialRate`, and a condition that cites it there fails the run.

A task's `runtime` says which build plays it: `unity` (the default), or `godot`, the Godot build task_builder makes.
Each build's runner claims the tasks set to it. A task whose `implementation` names another skill's scheme is that
skill's to play, not the Unity runner's: `simulate://assessment-unity` hands it to the simulate skill's simulated
build, which plays the timeline the wired Parameters define without Unity, so a study of such tasks needs no build. No runner plays the Godot build yet, so a local study with a task set
to it stops before its first step, saying so, and the browser runner refuses it; the instrument, the timeline and the
Parameters wired in mean the same whichever build plays the task.

This skill is the boundary between Studyflow and the builds that play Behaverse tasks, the Unity build today. To
Studyflow it offers `behaverse:*` elements and runners that keep its contract; to a build its runners speak that
build's own protocol (the Unity build's is assessment-unity's `docs/studyflow-protocol.md`). Behaverse's words
(instrument, timeline, the BDM's names) live here, and a build's workings stay behind its protocol.

- `browser/` is the browser runtime's node module: the Unity build in a frame, the model bot, and its dev-server
  plugins (`vite.ts`).
- `local.py` serves the same build from a local port and opens it in a browser window per task;
  the build is looked for at `UNITY_BUILD_PATH`, then `run/assessment-unity/Build/WebGL`, then the assessment-unity checkout beside the repo.
- `examples/` are bot-played studies; `tests/` cover the payload and the local runner.
