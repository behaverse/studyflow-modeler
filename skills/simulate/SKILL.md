---
name: simulate
description: "A simulated participant that knows no task: a pool that answers each trial with one of the options it lists, at random, seeded by the run. Use to run a study on this machine before any person or model takes it, where what the answers are does not matter."
license: MIT
compatibility: "Local runtime with uv; standard library only."
metadata:
  schemes: "simulate"                  # the <scheme>:// references its runners execute
  runtimes:
    local: "uv run --script local.py"
---

A runner-only skill. It claims every pool with no process whose `studyflow:Actor` `implementation` is
`simulate://random`, and answers each message sent to it with one of the options the message lists
(`ResponseOptions`, at the message's top level or in the one value of it that lists some), drawn by the study's seed
and the message's id, so a run repeats exactly. A message that lists no options is an instruction, which it confirms
with `READY`.

It knows no task, so it plants no effect, and it never fails to answer. A study that needs answers whose truth it knows,
to check that its analysis recovers an effect, draws a taker of its tasks' own skill instead (for the Behaverse
battery, a pool typed `behaverse:SimulatedTaker`, its planted accuracies written in the study). Swap the pool's
`implementation` for `ollama://<model>` and the same file asks a language model instead. `test_local.py` is its
self-check.
