---
name: jspsych
description: "Opens a jsPsych timeline (a .json export of its trials) in the modeler as a studyflow of cognitive tasks, one per plugin node, with its consent form detected, and plays a `jspsych://` step: in the browser runtime for a person, and in a local run for whoever its message flows reach, a model or a simulated actor answering every trial. Use when a study already exists as a jsPsych experiment, or runs jsPsych plugins."
license: MIT
compatibility: "The browser runtime; the local runtime with uv and a Chromium (Chrome, Chromium, Brave or Edge), which it runs headless. The jsPsych builds load from unpkg, or in a local run from a node_modules folder that holds them."
metadata:
  schemes: "jspsych"  # the <scheme>:// references its runners execute
  runtimes:
    browser: "browser/index.tsx"
    local: "uv run --script local.py"
  modeler: "modeler.ts"
---

The skill opens a jsPsych timeline in the modeler as a study, and plays a `jspsych://` step: in the browser runtime
for a person, and in a local run for whoever the step's message flows reach.

```yaml
AXCPT:
  type: Task
  name: AX-CPT
  extensions:
    cognitive:CognitiveTask:
      platform: jspsych
      implementation: jspsych://html-keyboard-response@8
  inputs:
    In_AXCPT_Parameters:
      source: $AXCPT_Parameters

AXCPT_Parameters:
  type: DataObjectReference
  name: Parameters
  extensions:
    studyflow:Parameters:
      values:
        choices: [f, j]
        trial_duration: 1000
        data: {task: AXCPT}
        timeline_variables:
          - {block: Test, stimulus: A, condition: Cue, correct_response: j}
          - {block: Test, stimulus: X, condition: AX, correct_response: f}
        ResponseOptions: {Match: f, NonMatch: j}
        Bot:
          MaxExternalResponseTime: 3
```

[`jspsych_axcpt`](examples/jspsych_axcpt.studyflow.yaml) is a whole study: an AX-CPT that a simulated participant on
the task's band answers in a local run, with a conditional boundary event for too many unanswered trials and an
error boundary event for a task that cannot be played.

## Opening a timeline

"Open File..." in the modeler takes a `.json` jsPsych timeline and converts it on the way in.

- Each timeline node becomes a `cognitive:CognitiveTask` with `platform: jspsych`.
- Its plugin is bound as a `jspsych://<plugin>@<version>` implementation.
- Its parameters are kept in a `studyflow:Parameters` object wired into the task.
- A consent plugin becomes the study's consent form.

Nothing here writes a timeline back.

## In the browser

The browser runtime plays any step whose `implementation` is `jspsych://<plugin>@<version>` (`browser/`).

- The version is jsPsych's (7 or 8), which picks the plugin's release line. Both builds load from unpkg.
- The Parameters wired into the step are the plugin's parameters. With `timeline_variables` they become a timeline
  over them, each variable a trial parameter the Parameters do not set (`randomize_order`, `repetitions` and
  `sample` apply to it).
- The step's result is jsPsych's data, one row a trial, so `{AXCPT}` reads them.

## In a local run

`local.py` plays the same steps, every trial answered by the actor the step's band names or its message flows
reach, as the Behaverse runner plays a task on its build ([behaverse](../behaverse/SKILL.md)). A study can therefore
run its AX-CPT as a jsPsych timeline and its other tasks on the Behaverse build, with one model or one simulated
actor answering them all.

- The runner claims every step whose `implementation` is a `jspsych://` reference, for jsPsych 8 (its 2.x plugins)
  alone. A reference it cannot play stops the run before its first step.
- It serves a stage page (`stage.html`) and the two builds from a local port, and opens the page in a headless
  Chromium: the one the runner SDK finds for any runner's page (`packages/runtime-local/python/chromium.py`).
- jsPsych plays the step's timeline there, made by the browser runtime's rule (`timelines.json` in `tests/` holds
  both to it), in its own data-only simulation mode. The timeline is jsPsych's to run (its variables, order,
  repetitions, sampling), and each trial's data are the plugin's own, made by its `simulate` hook from the response
  the runner brings back from the actor, after the plugin's defaults and checks.
- A task the runner cannot play as written fails as a step (a `ResponseOptions` entry that names a key its `choices`
  do not list), and an error boundary event on the task catches the failure.

### Why simulation mode

The runner uses real jsPsych code, with nothing drawn and no clock running.

- A model slower than a person is not cut off by a timer that runs while it thinks.
- A simulated actor's whole session takes seconds.
- The trial's window is still jsPsych's, whose own check drops a response later than its `trial_duration`, unless
  the task settings give the actor longer ([Task settings](#task-settings)).

Driving a page's keys in real time (through Playwright, say) would time the actor against the protocol's display
clock, and add a Node and browser download to a runner that is a uv script.

### The message to the actor

A trial goes to the actor through the runner SDK's exchange (`packages/runtime-local/python/exchange.py`), as a
Behaverse task's trial does: along the task's own message flows, else its enclosing sub-process's, else its pool's.
It carries a `cognitive:Trial` and brings back a `cognitive:Response` (or names no message), so one pair of flows at
pool level carries a study's jsPsych and Behaverse trials alike. The message holds, in this order:

| Field | Value |
| --- | --- |
| The task's data inputs | The `agentic:Prompt` wired into it. |
| `TrialIndex` | The trial's place in its block, from 0. |
| `Stimulus` | The text the trial's markup shows. |
| `ResponseOptions` | The options the actor may answer with. |
| `MaxResponseTime` | The seconds the actor has to answer ([Task settings](#task-settings)). |

- The trial's task, its condition and its right answer never go with it, as they never show on the screen. Neither
  does the plugin's `prompt`, which names keys: the prompt wired into the task says what a trial asks for.
- The options are those `ResponseOptions` names, a mapping at the top of the Parameters from each option to the key
  it presses (`{Match: f, NonMatch: j}`). The runner reads it and never hands it to jsPsych. Without it, the options
  are the trial's `choices` themselves, keys or a button plugin's labels.
- A reply that names one option, whole and in any case, as the SDK reads a reply (`option_named`), is the trial's
  response: that key, or that button's place, at the time it took.
- Any other reply, or none in time, leaves the trial unanswered, and nothing stands in for it.
- A call to the actor that fails is no unanswered trial: it fails the task, as it fails any step that asks.
- A trial that lists no choices (`NO_KEYS`, `ALL_KEYS`, a plugin with none) offers nothing: jsPsych records it with
  no response, and the actor never sees it.

### Task settings

The task settings say how a task plays for an actor that is not a person, while the protocol keeps its human timing,
as they do for a Behaverse task.

- The plan hands a runner the Parameters wired into a step merged into one
  ([the contract](../../packages/runtime-local/CONTRACT.md), "The plan"), so the runner tells the protocol from the
  settings by their keys, not by the object each came from.
- The settings are the `Bot` entry, which the Behaverse runners read too, so a study wires one settings object into
  its jsPsych and its Behaverse tasks alike. All but `Bot` and `ResponseOptions` is jsPsych's, and neither of those
  reaches it.
- Of `Bot`, this runner reads `MaxExternalResponseTime`: above 0, it is the seconds the actor has for every trial,
  in place of the trial's `trial_duration`. The rest (`Speed`, `SkipInstructions`, `AutoClickInstructions`,
  `SkipFocusArea`) is the Behaverse build's and changes nothing here.
- Written at the top of the Parameters, `MaxExternalResponseTime` would reach jsPsych as a trial parameter and
  change no deadline, so it stops the task before it starts.

The deadline follows from the settings.

- A trial is sent, as its `MaxResponseTime`, that setting, else its `trial_duration`, else 30 s (for a trial that
  waits however long it takes). Its answer counts when it comes in that time, as the SDK's exchange times it (a
  quarter of a second short of it, and never under a second).
- An answer later than the trial's `trial_duration` but within the setting reaches jsPsych at the end of the trial's
  window, its `rt` the `trial_duration`. The plugin's own check keeps it, the timing jsPsych plays and records stays
  the protocol's, and its data say what that protocol can say, a response within the window.
- The record keeps the actor's real latency in `result.responseTime`, which is when the answer came, beside
  jsPsych's row under `data`, whose `rt` is the window's end.
- Without the settings, the deadline is the trial's window, and jsPsych drops a later answer itself.

### Records and result

Each trial the actor was sent becomes one `<task>.TrialEnd` record in the shape of the Behaverse Data Model, so one
trial schema reads a study's jsPsych and Behaverse tasks alike. The record is appended to the dataset the step's
data output names, else `<id>.events.jsonl`. The first write of a run starts that file (`records_uri` and
`opened_this_run` in the SDK).

| Field | Value |
| --- | --- |
| `trialContext.task.id` | The trial's `task`. |
| `trialContext.block` | `{id, name}`: the place of that run of trials among the blocks played, from 1, and the trial's `block`. |
| `trialContext.trial` | `{id, indexInBlock}`, from 1. |
| `trialContext.condition` | The trial's `condition`. |
| `result` | `{isAnswered, isCorrect, response, responseTime}`, from jsPsych's own data, the authority on whether the trial was answered. |
| `data` | jsPsych's row. |
| `context` | The SDK's stamp (`record_context`): the subject and the properties the dataset's schema names. |

- In `result`, `response` is the option the response was, `responseTime` the actor's latency in seconds, and
  `isCorrect` the response against the trial's `correct_response` as jsPsych compares keys (null without one, false
  when unanswered).
- A trial's `task`, `block`, `condition` and `correct_response` are its timeline variables, else the fields of its
  `data` (`data: {task: AXCPT}`). The task is the step's id when neither names one.
- The step's result has the shape a Behaverse task's has, counted from its records: `trials` answered, `events`, and
  `blocks`, `{block, trials, answered, unanswered, correct}`, block by block in the order played.
- The counts are data, not policy. A study writes what it keeps of them into a property through the task's data
  edge (`unanswered`, from
  `sum(result.blocks[block in scored_blocks].unanswered) / sum(result.blocks[block in scored_blocks].trials)`) and
  leaves the task on a conditional boundary event (`unanswered > max_unanswered`), as it does for a Behaverse task.
- jsPsych's draws (an order, a sample) are seeded by the study's seed, the step and the subject.
- The step's record notes the jsPsych and plugin versions that played, where their builds came from, and that seed.
  The builds come from `--modules`, `$JSPSYCH_MODULES`, else this checkout's `node_modules`, when it holds them at
  the reference's versions; else unpkg, which serves the latest of a major.

## Files

`trials.py` is what a trial is to the actor and to the record. `test_trials.py` and `test_local.py` are the runner's
self-checks, and `tests/jspsych-local.unit.spec.ts` plays an AX-CPT through the runner, its page in jsdom.
