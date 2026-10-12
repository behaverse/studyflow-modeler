---
name: jspsych
description: "Opens a jsPsych timeline (a .json export of its trials) in the modeler as a studyflow of cognitive tasks, one per plugin node, with its consent form detected, and plays a `jspsych://` step: in the browser runtime for a person, and in a local run for whoever its message flows reach, a model or a simulated actor answering every trial. Use when a study already exists as a jsPsych experiment, or runs jsPsych plugins."
license: MIT
compatibility: "The browser runtime; the local runtime with uv and a Chromium (Chrome, Chromium, Brave or Edge), which it runs headless. The jsPsych builds load from unpkg, or in a local run from a node_modules folder that holds them."
metadata:
  schemes: "jspsych"
  runtimes:
    browser: "browser/index.tsx"
    local: "uv run --script local.py"
  modeler: "modeler.ts"
---

"Open File..." in the modeler takes a `.json` jsPsych timeline and converts it on the way in: each timeline node
becomes a `cognitive:CognitiveTask` with `platform: jspsych`, its plugin bound as a `jspsych://<plugin>@<version>`
implementation and its parameters kept in a `studyflow:Parameters` object wired into the task; a consent plugin
becomes the study's consent form. Nothing here writes a timeline back.

The browser runtime plays any step whose `implementation` is `jspsych://<plugin>@<version>` (`browser/`): the version
is jsPsych's (7 or 8), which picks the plugin's release line, and both builds load from unpkg. The Parameters wired
into the step are the plugin's parameters; with `timeline_variables` they become a timeline over them, each variable
a trial parameter the Parameters do not set (`randomize_order`, `repetitions` and `sample` apply to it). The step's
result is jsPsych's data, one row a trial, so `{Flanker}` reads them.

## Local runs

In a local run, `local.py` plays the same steps, every trial answered by the actor the step's message flows reach, as
the Behaverse runner plays a task on its build (`../behaverse/SKILL.md`); so a study can run its AX-CPT as a jsPsych
timeline and its other tasks on the Behaverse build, one model or one simulated actor answering them all. It claims
every step whose `implementation` is a `jspsych://` reference, for jsPsych 8 (its 2.x plugins) alone; a reference it
cannot play stops the run before its first step. It serves a stage page (`stage.html`) and the two builds from a local
port and opens the page in a headless Chromium, where jsPsych plays the step's timeline, made by the browser runtime's
rule (`timelines.json` in `tests/` holds both to it), in its own data-only simulation mode: the timeline is jsPsych's
to run (its variables, order, repetitions, sampling), and each trial's data are the plugin's own, made by its
`simulate` hook from the response the runner brings back from the actor, after the plugin's defaults and checks. That
is the choice: real jsPsych code, with nothing drawn and no clock running. A model slower than a person is not cut off
by a timer that runs while it thinks, a simulated actor's whole session takes seconds, and the trial's window is still
jsPsych's, whose own check drops a response later than its `trial_duration`, unless the task settings give the actor
longer (below). Driving a page's keys in real time (through Playwright, say) would time the actor against the
protocol's display clock and add a Node and browser download to a runner that is a uv script; the Chromium is the one
the runner SDK finds for any runner's page (`packages/runtime-local/python/chromium.py`).

A trial goes to the actor through the runner SDK's exchange (`packages/runtime-local/python/exchange.py`), as a
Behaverse task's trial does, along the task's own message flows, else its enclosing sub-process's, else its pool's,
carrying a `cognitive:Trial` and bringing back a `cognitive:Response` (or naming no message), so one pair of flows at
pool level carries a study's jsPsych and Behaverse trials alike. The message is the task's data inputs (the
`agentic:Prompt` wired into it), then `TrialIndex` (its place in its block, from 0), `Stimulus` (the text its markup
shows), `ResponseOptions` and `MaxResponseTime`, the seconds it has to answer (below). What the trial is, its condition
and its right answer never go with it, as they never show on the screen; neither does the plugin's `prompt`, which names
keys: what a trial asks for is the prompt wired into the task. The options are those `ResponseOptions` names, a mapping
at the top of the Parameters from each option to the key it presses (`{Match: f, NonMatch: j}`), which the runner reads
and never hands jsPsych; without it, the trial's `choices` themselves, keys or a button plugin's labels. A reply that
names one, whole and in any case, as the SDK reads a reply (`option_named`), is the trial's response: that key, or that
button's place, at the time it took. Any other reply, or none in time, leaves the trial unanswered, and nothing stands
in for it. A trial that lists no choices (`NO_KEYS`, `ALL_KEYS`, a plugin with none) offers nothing: jsPsych records it
with no response, and the actor never sees it.

The task settings say how a task plays for an actor that is not a person, while the protocol keeps its human timing,
as they do for a Behaverse task. The plan hands a runner the Parameters wired into a step merged into one
(`../../packages/runtime-local/CONTRACT.md`, "The plan"), so the runner tells the protocol from the settings by their
keys, not by the object each came from: the settings are the `Bot` entry, which the Behaverse runners read too, so a
study wires one settings object into its jsPsych and its Behaverse tasks alike; all but `Bot` and `ResponseOptions` is
jsPsych's, and neither of those reaches it. Of `Bot`, this runner reads `MaxExternalResponseTime`: above 0, it is the
seconds the actor has for every trial, in place of the trial's `trial_duration`; the rest (`Speed`,
`SkipInstructions`, `AutoClickInstructions`, `SkipFocusArea`) is the Behaverse build's and changes nothing here.
Written at the top of the Parameters, `MaxExternalResponseTime` would reach jsPsych as a trial parameter and change no
deadline, so it stops the task before it starts. A trial is sent, as its `MaxResponseTime`, that setting, else its
`trial_duration`, else 30 s (for a trial that waits however long it takes), and its answer counts when it comes in
that time, as the SDK's exchange times it (a quarter of a second short of it, and never under a second).
An answer later than the trial's `trial_duration` but within the setting reaches jsPsych at the end of the trial's
window, its `rt` the `trial_duration`: the plugin's own check keeps it, the timing jsPsych plays and records stays the
protocol's, and its data say what that protocol can say, a response within the window. The record keeps the actor's
real latency in `result.responseTime`, which is when the answer came, beside jsPsych's row under `data`, whose `rt` is
the window's end. Without the settings, the deadline is the trial's window, and jsPsych drops a later answer itself.

Each trial the actor was sent becomes one `<task>.TrialEnd` record in the shape of the Behaverse Data Model, so one
trial schema reads a study's jsPsych and Behaverse tasks alike, appended to the dataset the step's data output names
(else `<id>.events.jsonl`; the first write of a run starts it, `records_uri` and `opened_this_run` in the SDK):
`trialContext.task.id`, the trial's `task`; `block`, `{id, name}`, the trial's `block` and the place of that run of
trials among the blocks played, from 1; `trial`, `{id, indexInBlock}`, from 1; `condition`, the trial's `condition`; and
`result`, `{isAnswered, isCorrect, response, responseTime}`, from jsPsych's own data, the authority on whether it was
answered, with the option the response was and the actor's latency in seconds (above), `isCorrect` against the trial's
`correct_response` as jsPsych compares keys (null without one, false when unanswered). A trial's `task`, `block`,
`condition` and `correct_response` are its timeline variables, else the fields of its `data` (`data: {task: AXCPT}`);
the task is the step's id when neither names one. The record keeps jsPsych's row under `data`, and the SDK's `context`
stamp (`record_context`): the subject and the properties the dataset's schema names. The step's result has the shape a
Behaverse task's has, counted from its records: `trials` answered, `events`, and `blocks`, `{block, trials, answered,
unanswered, correct}`, block by block in the order played. Data, not policy: a study writes what it keeps of them into a
property through the task's data edge (`unanswered`, from `sum(result.blocks[block in scored_blocks].unanswered) /
sum(result.blocks[block in scored_blocks].trials)`) and leaves the task on a conditional boundary event (`unanswered >
max_unanswered`), as it does for a Behaverse task. jsPsych's draws (an order, a sample) are seeded by the study's seed,
the step and the subject, and the step's record notes the jsPsych and plugin versions that played, where their builds
came from (`--modules`, `$JSPSYCH_MODULES`, else this checkout's `node_modules`, when it holds them at the reference's
versions; else unpkg, which serves the latest of a major), and that seed.

`trials.py` is what a trial is to the actor and to the record; `test_trials.py` and `test_local.py` are the runner's
self-checks, and `tests/jspsych-local.unit.spec.ts` plays an AX-CPT through it, its page in jsdom.
