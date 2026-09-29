---
name: simulate
description: "Simulated tasks and participants with a planted truth: Simon and N-back timelines as trial lists, a participant pool whose answers carry a known effect (or none), and the trial records an analysis reads. Use to check that a study's registered analysis recovers an effect it was built to find, before any person or model takes it."
license: MIT
compatibility: "Local runtime with uv; standard library only."
metadata:
  schemes: "simulate"                  # the <scheme>:// references its runners execute
  runtimes:
    local: "uv run --script local.py"
---

A runner-only skill. It claims three kinds of element by their `implementation`:

- **A timeline**, `simulate://simon` or `simulate://nback`, on a step: the trial list of one task, seeded by the
  study's seed and the step's id, so every subject meets the same timeline. Its `additionalArguments` set its size
  (`trials: 30`; for the N-back `n: 1`, `blocks: [Test_A, Test_B]`, `trials: 28`, `matchRate: 0.33`). Each trial names
  its `ResponseOptions` and the rule that maps a stimulus to the right one; an N-back trial also carries the digits
  shown before it, because a pool is asked one message at a time and remembers nothing between them.
- **A participant**, a pool with no process whose `studyflow:Actor` `implementation` is `simulate://planted` or
  `simulate://null`. It answers each trial it is sent with one of the trial's `ResponseOptions`, correct with a
  planted probability: `planted` is less accurate on incongruent Simon trials than on congruent ones, and less
  accurate throughout when the instruction wired into the asking step asks for speed (its text names `fast` or
  `first impression`); `null` is equally accurate everywhere. Either leaves about one trial in thirty
  unanswered. A message that carries no trial is an instruction, which it confirms with `READY`. Draws are seeded
  by the study's seed and the message's id, so a run repeats exactly. The table of probabilities is `PLANTED` in
  `local.py`: the truth a study's analysis should recover.
- **A record**, `simulate://record`, on a step whose data inputs are a timeline and the answers collected for it
  (a multi-instance pass's `loopDataOutputRef`): it scores each answer against its trial and appends one row per
  trial to the data store its data output names (`.jsonl`), keyed by `subject` and `arm` from its
  `additionalArguments` (placeholders resolve by the [rule](../../docs/reference.qmd#placeholders)). Its result is
  `{trials, answered, failedTrialRate}`, which a conditional boundary event can read.

Swap the pool's `implementation` for `ollama://<model>` and the same file asks a language model instead: the
trials, the records and the analysis stay as they are. `test_local.py` is its self-check.
