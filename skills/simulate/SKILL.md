---
name: simulate
description: "Simulated tasks and participants with a planted truth: Simon and N-back timelines as trial lists, a stand-in for the Behaverse build that plays its AX-CPT, Simon and N-back tasks without Unity, a participant pool whose answers carry a known effect (or none), and the trial records an analysis reads. Use to check that a study's registered analysis recovers an effect it was built to find, before any person or model takes it."
license: MIT
compatibility: "Local runtime with uv; standard library only."
metadata:
  schemes: "simulate"                  # the <scheme>:// references its runners execute
  runtimes:
    local: "uv run --script local.py"
---

A runner-only skill. It claims four kinds of element by their `implementation`:

- **A timeline**, `simulate://simon` or `simulate://nback`, on a step: the trial list of one task, seeded by the
  study's seed and the step's id, so every subject meets the same timeline. Its `additionalArguments` set its size
  (`trials: 30`; for the N-back `n: 1`, `blocks: [Test_A, Test_B]`, `trials: 28`, `matchRate: 0.33`). Its result is
  `{trials, key}`, which its data outputs select (`transformation: result.trials`, `result.key`). A trial is what a
  subject is shown: its `ResponseOptions` and the rule that maps a stimulus to the right one; an N-back trial also
  carries the digits shown before it, because a pool is asked one message at a time. The key, trial by trial, is the
  right answer and the condition, which no subject is sent.
- **A simulated build**, a `behaverse:Task` whose `implementation` is `simulate://assessment-unity` (a version after
  `@` is allowed and ignored, so a study's copy for the Unity build, `behaverse://assessment-unity@26.10`, differs from
  it in the scheme alone): the task is played without Unity, by `assessment.py`, which the Unity build's runner
  (`skills/behaverse/local.py`) then leaves alone. It plays the task's `timeline`, which the Parameters wired into the
  task must define under `Timelines`, block by block (an entry with a `Name`, merged over that block's definition
  under `Blocks`; one without is a page of instructions), and sends each trial along the task's message flows as the
  Unity build's runner relays the build's: the task's data inputs (a wired `agentic:Prompt` by its id), then
  `TrialIndex`, `Stimulus`, `ResponseOptions` (`Match`/`NonMatch`, `Left`/`Right`), `MaxResponseTime` and `Scene`.
  It scores the answer as the build does and writes the battery contract's records to the task's dataset with the
  runner's `context` stamp: a `<TASK>.TaskStart`, one `<TASK>.TrialEnd` per trial presented (`trialContext.condition`,
  `load` for the N-back, `result.isAnswered`, `isCorrect`, `response`, `responseTime`), and a `<TASK>.TaskEnd`. Its
  result is the Unity runner's, `{TaskId, TimelineId, IsCompleted, trials, failedTrialRate, events}`, the rate by the
  task's `ScoredBlocks` and the same rule. Three instruments, read as the build's config shape:
  - `RE`, the AX-CPT: a trial per letter of `ItemSequence` (`{Sequence: {Type: Ordered, Values: [...]}}`, 0 for A, a
    negative value `v` a distractor of letter `-v - 1`; `SequenceLength` letters), `StimulusType: UpperCaseLetters`,
    one two-letter `ResponsePatterns` (`[AX]`), `UseNonMatchButton: true`, `StimulusColor`, `DistractorColor`. The
    stimulus is `{Letter, Color, IsDistractor}`; Match is right on an X right after an A among the letters so far,
    distractors aside. The condition is `Cue`, `AX`, `AY`, `BX`, `BY` (the cue/probe alternation of that stream) or
    `Distractor`. The window is `StimulusDisplayDuration` plus that letter's `InterStimulusInterval`.
  - `WO`, the Simon task (`PrimaryFeature: Color`, `SecondaryFeature: Position`, two `ButtonColors`): the block's
    `Trials` cells (`Congruency`, `CorrectButton`), each `ItemOccurrences` times in a seeded order (`TrialOrder`,
    `Replacement: WithoutInBlock`), or as many trials as a `Trials` exit rule says, each drawn from the parameters'
    `Distribution: {Type: Uniform}`. The stimulus is `{Target, Buttons, NeutralSymbol, NeutralColor}`, the disk of
    the correct button's colour over it (Congruent), over the other (Incongruent) or centred (Neutral); the window is
    `MaxResponseTime`.
  - `NB`, the N-back: one stream (`Streams`) at `NValue` back, its `StimulusValue` an Ordered sequence or one the
    build generates (`Type: NBack`: `StreamSize` digits from 1 to `FeatureValuesCount`, exactly `MatchCount`
    matches, at places drawn from the run's seed; the lure counts are not reproduced). The stimulus is
    `{Value, Load}`; the first `NValue` digits are the burn-in (`BurnIn`), sent so the responder sees every digit and
    never scored (NonMatch is right, there being nothing to match); then `Match` or `NonMatch`. The window is
    `StimulusDisplayDuration` plus `InterStimulusInterval`, or `MaxResponseTime` when `PlayerPaced`.

  `{Reference: Name}` reads the block's parameter of that name. A block's `Trials` exit rules end it (after so many
  trials, successes or failures, in all or `Consecutive`), and one with `Action: FailBlock`, or an accuracy below its
  `MinAccuracyRequired`, plays it again, freshly drawn, up to `MaxRepeats` times (2 by default), each play a block of
  its own in the records; a `Time` rule never ends one, nothing here taking time. What is drawn (a Simon order, an
  N-back stream) comes from the study's seed, the task's id and the block, so every subject meets the same. `Bot:` in
  the Parameters says how the Unity build's bot plays and is ignored, but for `MaxExternalResponseTime`: when it is
  above 0 it is the `MaxResponseTime` of every trial, as the Unity build sends it to an external responder; otherwise
  the protocol's window above is. Every block is read before the first trial is sent, so what the build cannot play as
  written stops the task with an error naming the key: a timeline the Parameters do not define, a block key it does
  not apply (`RepeatTrials`, `Adapt` with steps), a sequence other than Ordered, another stimulus type or feature, a
  parameter it needs that is not written inline (it has no copy of the build's own), or a `ScoredBlocks` name the
  timeline does not play. Each trial's request id is the task's, the subject's, the block's and the trial's
  (`Task_AXCPT.3.2.17`), so a simulated participant, which draws by it, draws afresh for every subject.
- **A participant**, a pool with no process whose `studyflow:Actor` `implementation` is `simulate://planted` or
  `simulate://null`. It answers each trial it is sent with one of the trial's `ResponseOptions`, telling the right
  one and the trial's condition from the stimulus as a person would, and gives the right one with a planted
  probability; either profile leaves about one trial in thirty unanswered (`MISS_RATE`). A message that carries no
  trial is an instruction, which it confirms with `READY`. Draws are seeded by the study's seed and the message's id,
  so a run repeats exactly, and a build that gives each subject's trials ids of their own draws afresh per subject. A
  prompt the asking step sends by its id alone is written out from its `template`, its placeholders filled from the
  step's scope, as a model's runner writes it. The trials of the Behaverse build (or of the simulated build above)
  arrive as the message itself, one letter or digit at a time, so the subject keeps, per conversation
  (`memory: conversation` on the pool gives one per subject), what the block has shown so far; a `TrialIndex` that
  does not follow the last one starts a block afresh:
  - a Simon trial (`Target`) by the button of the target's colour: congruent when the target sits over it,
    incongruent over the other, neutral between them;
  - an AX-CPT letter (`Letter`): Match only on an X right after an A, the letters before it remembered with the
    distractors aside; those letters alternate cue and probe, so a probe's condition is its cue and itself (AX, AY,
    BX, BY), and a distractor is `Distractor`;
  - an N-back digit (`Value`) at its `Load` (1 without one): Match when it is the digit that many before it, the
    burn-in digits remembered too; before there is one, it is the burn-in (`BurnIn`), answered NonMatch.

  `null` answers every trial with one probability, 0.85. `planted` answers by the table `PLANTED` in `local.py`, the
  truth a study's analysis should recover:

  | Task | Condition | P(correct) |
  | --- | --- | --- |
  | AX-CPT | Cue | .97 |
  | AX-CPT | AX | .95 |
  | AX-CPT | AY | .85 |
  | AX-CPT | BX | .70 standard, .88 goal support |
  | AX-CPT | BY | .95 |
  | AX-CPT | Distractor | .97 |
  | Simon | Congruent | .95 |
  | Simon | Incongruent | .80 |
  | N-back | 1-back | .92 |
  | N-back | 2-back | .78 |
  | N-back | BurnIn | .97 |

  and 0.85 on any other condition. The subject is in the goal-support arm when a text sent with the trial (a reminder
  prompt wired into the task, its template a property such as `{reminder_axcpt}`, or the task's instructions ending
  with it) has a line beginning with `Reminder:`, and in the
  standard arm otherwise (an empty reminder, or none); only the BX probes differ between the arms. At about 20
  completers per arm, each taking the AX-CPT's four test blocks of `XCIT_RE_02` (16 BX and 64 BY probes), 80 Simon
  trials, and the 1-back's two and the 2-back's four test blocks, the three effects reach one-sided p < .05/9
  (Welch's t between arms on the BX minus BY error cost; one-sample t on the Simon incongruent minus congruent error
  cost and on 1-back minus 2-back accuracy), and none of them does under `null`: `test_local.py` checks it on one
  seeded cohort. Trials a timeline step of this skill sends (above) carry their rule in words, and take the same
  table (Simon by congruency, the N-back by its `n`).
- **A record**, `simulate://record`, on a step whose data inputs are a timeline's trials and key and the answers
  collected for it (a multi-instance pass's `loopDataOutputRef`): it scores each answer by the key and appends one row per
  trial to the data store its data output names (`.jsonl`), keyed by `subject` and `arm` from its
  `additionalArguments` (placeholders resolve by the [rule](../../docs/reference.qmd#placeholders)). Its result is
  `{trials, answered, failedTrialRate}`, which a conditional boundary event can read. An answer counts when it is one
  of the trial's `ResponseOptions`: which option a free reply names is the study's call, written in FEEL on the asking
  step's data output (`if contains(lower case(result), "non-match") then "non-match" else if contains(lower
  case(result), "match") then "match" else null`), so the scoring is in the file the protocol digest covers.

Swap the pool's `implementation` for `ollama://<model>` and the same file asks a language model instead: the
trials, the records and the analysis stay as they are. `test_local.py` and `test_assessment.py` (the simulated build) are its self-checks.
