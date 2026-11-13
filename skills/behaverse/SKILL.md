---
name: behaverse
description: "The Behaverse assessment battery: its tasks and BDM datasets, and the runner that plays the tasks on the Behaverse Unity WebGL build, in the browser runner's page or in a window of its own. A person takes a task, or a model on its band, the build's random bot, or whoever its message flows reach. Use when a study includes Behaverse assessment tasks."
license: MIT
compatibility: "Browser runtime, or the local runtime with uv; both need a Behaverse WebGL build (UNITY_BUILD_PATH), but for the simulated build, which plays locally without one."
metadata:
  schemes: "behaverse"  # the <scheme>:// references its runners execute
  schema: "behaverse.moddle.yaml"
  runtimes:
    browser: "browser/index.tsx"
    local: "uv run --script local.py"
  modeler: "modeler.ts"
---

This skill is the boundary between Studyflow and the builds that play Behaverse tasks, the Unity build today. To
Studyflow it offers `behaverse:*` elements and runners that keep its contract; to a build its runners speak that
build's own protocol (the Unity build's is assessment-unity's `docs/studyflow-protocol.md`). Behaverse's words
(instrument, timeline, the BDM's names) live here, and a build's workings stay behind its protocol.

The vocabulary is `behaverse.moddle.yaml`: `behaverse:Task`, `behaverse:BDMDataset`, and the literals it adds to
cognitive's software list and the core's dataset formats. The runners execute `behaverse:Task`.

```yaml
Warmup_1Back:
  type: ChoreographyTask
  name: 1-Back warm-up
  participant: $Actor_Random_bot
  extensions:
    behaverse:Task:
      instrument: NB
      timeline: Demo3_Warmup
  inputs:
    In_Warmup_1Back_Parameters:
      source: $Warmup_1Back_Parameters
```

## A task

| Attribute | Meaning |
| --- | --- |
| `instrument` | Which task of the battery runs (`NB`): the wire's `scene`, BDM's `instrument_id`. |
| `timeline` | The one timeline that runs: one the build ships for the instrument, or one defined under `Timelines` in the Parameters wired into the task. |
| `runtime` | Which build plays the task: `unity` (the default), or `godot`, the Godot build task_builder makes. |

- `instrument` and `timeline` are attributes of the task, and a wired Parameters key of the same name sets either.
- The task's GameConfig is the rest of those Parameters, merged, which the runtime hands over as the task's
  `parameters` (`Blocks`, `Timelines` definitions), less a `Bot:` entry for how the build's bot plays.
- A task naming no timeline has no trials to run, and is refused. So is an empty `Timelines` entry, which defines
  nothing.
- A task whose `implementation` names another skill's scheme is that skill's to play.
- No runner plays the Godot build yet, so a local study with a task set to it stops before its first step, saying
  so, and the browser runner refuses it. The instrument, the timeline and the Parameters wired in mean the same
  whichever build plays the task.

## Who answers

Who answers is what the diagram draws, never a `Bot:` entry, which only says how the build's bot plays.

- The browser runner plays a person, a model on the task's band (its `implementation` names it), or the build's
  random bot (a `software` actor whose `implementation` is `behaverse://bot`).
- Any other actor answers along message flows, locally.

In a local run, a task with message flows sends each awaiting trial along the one out of it, and injects the answer
that comes back.

- The flows are the task's own, or the nearest enclosing sub-process's, which is where BPMN can draw them when that
  sub-process is collapsed.
- The trial goes as the build describes it: `TrialIndex`, its `Stimulus`, `ResponseOptions`, `MaxResponseTime`, the
  instrument as `Scene`, and a `Screenshot` when the build takes one. The task's data inputs go with it, above all
  the `agentic:Prompt` wired into it.
- An answer that names one of the trial's options is injected. Any other answer, or none in time, is a miss, and
  nothing stands in for it.
- A call to the actor that fails is no miss: it fails the task, as it fails any step that asks, and an error
  boundary event on the task catches the failure.
- The flows carry the cognitive skill's `cognitive:Trial` out of the task and `cognitive:Response` back into it: the
  `structureRef` of an `ItemDefinition`, reached through the flow's `messageRef` and the message's `itemRef`. A flow
  naming another structure is some other skill's exchange, a flow naming none is taken for either, and two partners
  with no message named is an error rather than a guess.

The browser runner asks its model itself, by the same two rules: a reply that names no option is a miss, and a call
that fails fails the task, where an error boundary event on it catches the failure.

## Records

The task's trial records go to the `uri` its data output names, else `<id>.events.jsonl` in the run. Several tasks
may deposit into one drawn dataset, and a task in a loop plays once per pass: the first write of a run starts that
file, the rest append, and the next run starts it again.

Each line carries the runner's own `context` beside what the build recorded.

| `context` | Value |
| --- | --- |
| `subject` | The instance the nearest repeating scope around the task is on (`state._meta.instance`, 1-based): an enclosing activity, else the pool of several instances (`participantMultiplicity`) whose process holds the task. With no repeating scope around it, the task's own visit count, which the study's state keeps. |
| `state` | The properties in scope at the hand-off that the schema of the dataset the task writes names as `context.state.<name>` columns (`context.state.arm`, say), or every property in scope when that dataset has no schema. |

Every task of one subject therefore stamps the same number, whichever subjects left before reaching it, and a cohort
of four instances numbers them 1 to 4. The trials group by subject and by condition without joining anything in, and
a trial carries what the study says it reads and nothing else.

## The result

A task's result is a `behaverse:TaskResult`. The schema declares it as the task type's `meta.result`, and
`studyflow validate` checks the fields a data edge's `transformation` reads of it.

| Field | Value |
| --- | --- |
| `TaskId`, `TimelineId`, `IsCompleted` | The build's completion. |
| `trials` | How many trials were answered. |
| `events` | The records' file, in a local run. |
| `blocks` | The counts of the task's trials, block by block in the order played, each a `BlockCounts`. |

A `BlockCounts` is `{block, trials, answered, unanswered, correct}`: the block's name and how many of its trials the
build presented, recorded a valid response for, recorded none for, and scored correct (null when its records say
nothing of correctness). The browser runner tallies the same records by the same rule (`browser/blocks.ts`), so a
study reads one result whichever runtime plays it.

The build is the authority on what counts.

- Where the build writes one `<TASK>.TrialEnd` record per trial it presents (`RE.TrialEnd`, with
  `result.isAnswered`, `result.isCorrect` and `trialContext.condition`), those records say which trials were
  presented and answered. A `BurnIn` trial (the N-back's first digits of a block, sent so the responder sees every
  digit) is never counted.
- Otherwise a trial is one the build started or took a response in, answered by a `Click` or a `TrialEnd` with a
  `responseTime`. A trial that takes none (the burn-in, whose every stream the build records as `BurnInDisabled`)
  is not counted.
- Either way, an answer injected too late for the trial's window counts as unanswered, however well it named an
  option.

The counts are data, not policy: which blocks count, and what a study does about them, it writes as properties and
FEEL.

- A property `scored_blocks` names the study's test blocks once.
- A task's data edge writes the share of their trials left unanswered into a property, `unanswered`:
  `sum(result.blocks[block in scored_blocks].unanswered) / sum(result.blocks[block in scored_blocks].trials)`.
- A conditional boundary event on the task leaves on `unanswered > max_unanswered`.

## The simulated build

In a local run, a task whose trials go to a simulated actor, along its own message flows or those it inherits from
a sub-process or its pool, plays on the simulated build whatever its `runtime` says.

- The simulated build is a stand-in that plays the battery's AX-CPT (`RE`), Which One (`WO`) and N-back (`NB`)
  without Unity, from the timelines the Parameters wired into the task define (`simulated.py`).
- It has no screen, so its trials go along those flows, as the Unity build's runner sends them, and it writes the
  same records and returns the same result.
- A study whose tasks all go to a simulated actor needs no build, which is how a study's pipeline is checked where
  the truth is known.

## The simulated actor

The truth a pipeline check knows is planted on its actor, a pool typed `behaverse:SimulatedActor` (its
`implementation` is `behaverse://simulated-actor`). The actor reads each trial as a person would, and answers right
with the probability the study writes on it.

| Trial | How the actor reads it |
| --- | --- |
| Which One | The button of the target's colour. |
| AX-CPT | Match on an X right after an A. |
| N-back | A digit against the one `Load` before it. |
| Flanker (`FL`) | The side the middle arrow points to. |

- It remembers the letters and digits per conversation.
- A stimulus of one letter as text is an AX-CPT letter too, and one of five arrows as text, `<<><<`, is a flanker
  trial. The jspsych skill's local runner sends a jsPsych AX-CPT's and a jsPsych flanker's trials that way.

The study writes these attributes on the actor.

| Attribute | Meaning |
| --- | --- |
| `accuracy` | The probability of a right answer, by instrument and condition, with `default` for any other. |
| `prompted` | The accuracies that hold instead when a text sent with the trial (a prompt the task reads, written out from its template) has a line beginning with a key. This is how a study plants an effect of what it tells its participants. |
| `remembering` | The accuracies that hold instead when the actor keeps the conversation the trial belongs to, by its own `memory` or that of the sub-process the asking step is in. This is how a study plants an effect of what the actor remembers. |
| `missRate` | The share of trials it leaves unanswered. |
| `absent` | By step id, the share of subjects who never answer what that step asks (`absent: {Return: 0.25}`, the subjects who do not come back for a second session). |

`accuracy` goes by these conditions.

| Instrument | Conditions |
| --- | --- |
| AX-CPT | `Cue`, `AX`, `AY`, `BX`, `BY`, `Distractor` |
| Which One | `Congruent`, `Incongruent`, `Neutral` |
| N-back | `1-back`, `2-back`, `BurnIn` |
| Flanker | `Congruent` when the five arrows point one way, `Incongruent` otherwise |

- The actor's draws are seeded by the run's seed and the message's id.
- Whether it is absent for a subject is drawn once per subject and step, from the run's seed, the subject (the
  instance of the pool asking) and the step, so a re-run draws the same subjects.
- A message it leaves unanswered gets no answer at all (the SDK's `no_reply`). The step that asked waits until a
  boundary event ends it, a timer for a subject who never returned, and goes on from there. With
  `studyflow run --clock virtual` that wait takes no time. Every other step is answered as usual.
- Under the "protocol for any actor" digest, what the actor plants and how its pool is described are part of the
  actor and left out, as a model's name is. A pipeline check that swaps a study's actor for a simulated one, and
  changes nothing else, therefore shares that digest with the study.

## Files

- `browser/` is the browser runtime's node module: the Unity build in a frame, the model bot, and its dev-server
  plugins (`vite.ts`).
- `local.py` serves the same build from a local port and opens it in a browser window per task. It looks for the
  build at `UNITY_BUILD_PATH`, then `run/assessment-unity/Build/WebGL`, then the assessment-unity checkout beside
  the repo.
- `examples/` are bot-played studies; `tests/` cover the payload and the local runner.
