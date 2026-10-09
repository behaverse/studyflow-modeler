---
name: behaverse
description: "The Behaverse assessment battery: its tasks and BDM datasets, and the runner that plays the tasks on the Behaverse Unity WebGL build, in the browser runner's page or in a window of its own. A person takes a task, or a model on its band, the build's random bot, or whoever its message flows reach. Use when a study includes Behaverse assessment tasks."
license: MIT
compatibility: "Browser runtime, or the local runtime with uv; both need a Behaverse WebGL build (UNITY_BUILD_PATH), but for the simulated build, which plays locally without one."
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
and `state`, the properties in scope at the hand-off that the schema of the dataset the task writes names as
`context.state.<name>` columns (`context.state.arm`, say), or every property in scope when that dataset has no
schema, so the trials group by subject and by condition without joining anything in, and a trial carries what the study
says it reads and nothing else.

Who answers is what the diagram draws, never a `Bot:` entry, which only says how the build's bot plays. In a local
run a task with message flows — its own, or the nearest enclosing sub-process's, which is where BPMN can draw them
when that sub-process is collapsed — sends each awaiting trial as the build describes it (`TrialIndex`, its `Stimulus`,
`ResponseOptions`, `MaxResponseTime`, the instrument as `Scene`, and a `Screenshot` when the build takes one), and with
it the task's data inputs (the `agentic:Prompt` wired into it, above all), along the one out of it, and injects the answer that comes back naming one of the trial's options; any other answer, or none in time, is a miss, and nothing stands in for it.
The browser runner plays a person, a model on the task's band (its `implementation` names it), or the build's random
bot (a `software` taker whose `implementation` is `behaverse://bot`); any other taker answers along message flows, locally.
Its result is a `behaverse:TaskResult` (the schema declares it, as the task type's `meta.result`, and `studyflow
validate` checks the fields a data edge's `transformation` reads of it): the build's completion (`TaskId`,
`TimelineId`, `IsCompleted`), `trials` answered, `events`, the records' file in a local run, and `blocks`, what the
task's trials came to, block by block in the order played, each a `BlockCounts`, `{block, trials, answered,
unanswered, correct}`: the block's name and how many of its trials the build presented, recorded a valid response for,
recorded none for, and scored correct (null when its records say nothing of correctness). The browser runner tallies
the same records by the same rule (`browser/blocks.ts`), so a study reads one result whichever runtime plays it. The build is the authority: where it writes one `<TASK>.TrialEnd` record per trial it presents (`RE.TrialEnd`, with
`result.isAnswered`, `result.isCorrect` and `trialContext.condition`), those records say which trials were presented
and answered, and a `BurnIn` trial (the N-back's first digits of a block, sent so the responder sees every digit) is
never counted;
otherwise a trial is one it started or took a response in, answered by a `Click` or a `TrialEnd` with a
`responseTime`, and a trial that takes none (the burn-in, whose every stream the build records as `BurnInDisabled`)
is not counted. Either way an answer injected too late for the trial's window counts as unanswered however well it
named an option. It is data, not policy: which blocks count, and what a study does about them, it writes as properties
and FEEL. A property `scored_blocks` names the study's test blocks once; a task's data edge writes the share of their
trials left unanswered into a property, `unanswered` (`sum(result.blocks[block in scored_blocks].unanswered) / sum(result.blocks[block in scored_blocks].trials)`); and a conditional boundary event on the task leaves
on `unanswered > max_unanswered`.

A task's `runtime` says which build plays it: `unity` (the default), `godot`, the Godot build task_builder makes, or
`simulated`, a stand-in that plays the battery's AX-CPT (`RE`), Which One (`WO`) and N-back (`NB`) without Unity,
from the timelines the Parameters wired into the task define (`simulated.py`). It has no screen, so its trials go along
the task's message flows, as the Unity build's runner sends them, and it writes the same records and returns the same
result; a study of such tasks alone needs no build, which is how a study's pipeline is checked where the truth is
known. A task whose `implementation` names another skill's scheme is that skill's to play. No runner plays the Godot
build yet, so a local study with a task set to it stops before its first step, saying so, and the browser runner
refuses it; the instrument, the timeline and the Parameters wired in mean the same whichever build plays the task.

The truth a pipeline check knows is planted on its taker, a pool typed `behaverse:SimulatedTaker` (its
`implementation` `behaverse://simulated-taker`), which reads each trial as a person would (the button of a Which One
target's colour, Match on an AX-CPT X right after an A, an N-back digit against the one `Load` before it, the
letters and digits remembered per conversation) and answers right with the probability the study writes on it:
`accuracy`, by instrument and condition (AX-CPT `Cue`, `AX`, `AY`, `BX`, `BY`, `Distractor`; Which One `Congruent`,
`Incongruent`, `Neutral`; N-back `1-back`, `2-back`, `BurnIn`), with `default` for any other; `prompted`, what holds
instead when a text sent with the trial (a prompt the task reads, written out from its template) has a line
beginning with a key, which is how a study plants an effect of what it tells its participants; and `missRate`, the
share of trials it leaves unanswered. Its draws are seeded by the run's seed and the message's id. Under the
"protocol for any actor" digest, what it plants is part of the actor and left out, as a model's name is.

This skill is the boundary between Studyflow and the builds that play Behaverse tasks, the Unity build today. To
Studyflow it offers `behaverse:*` elements and runners that keep its contract; to a build its runners speak that
build's own protocol (the Unity build's is assessment-unity's `docs/studyflow-protocol.md`). Behaverse's words
(instrument, timeline, the BDM's names) live here, and a build's workings stay behind its protocol.

- `browser/` is the browser runtime's node module: the Unity build in a frame, the model bot, and its dev-server
  plugins (`vite.ts`).
- `local.py` serves the same build from a local port and opens it in a browser window per task;
  the build is looked for at `UNITY_BUILD_PATH`, then `run/assessment-unity/Build/WebGL`, then the assessment-unity checkout beside the repo.
- `examples/` are bot-played studies; `tests/` cover the payload and the local runner.
