---
name: simulate
description: "A simulated participant that knows no task: a pool that answers each trial with one of the options it lists, at random, seeded by the run. Use to run a study on this machine before any person or model takes it, where what the answers are does not matter."
license: MIT
compatibility: "Local runtime with uv; standard library only."
metadata:
  schemes: "simulate"  # the <scheme>:// references its runners execute
  runtimes:
    local: "uv run --script local.py"
---

A runner-only skill. It claims every pool with no process whose `studyflow:Actor` `implementation` is
`simulate://random`, and answers each message sent to that pool.

```yaml
participants:
  Pool_Session:
    name: Session
    process: $Session

  Pool_Participant:
    name: Simulated participant
    extensions:
      studyflow:Actor:
        implementation: simulate://random
messageFlows:
  Msg_Question:
    name: a question
    source: $Pool_Session
    target: $Pool_Participant

  Msg_Answer:
    name: the answer
    source: $Pool_Participant
    target: $Pool_Session
```

[`simulated_screening`](examples/simulated_screening.studyflow.yaml) asks two screening questions this way, and
[`trial_list`](../python/examples/trial_list.studyflow.yaml) plays a registered trial list. Swap the pool's
`implementation` for `ollama://<model>` and the same file asks a language model instead.

## Answers

- A message that lists options gets one of them. The options are its `ResponseOptions`, at the message's top level
  or in the one value of it that lists some.
- The draw is seeded by the study's seed and the message's id, so a run repeats exactly.
- A message that lists no options is an instruction, which the pool confirms with `READY`.

## Limits

The pool knows no task, so it plants no effect, and it never fails to answer. A study that needs answers whose truth
it knows, to check that its analysis recovers an effect, draws a simulated actor of its tasks' own skill instead: for
the Behaverse battery, a pool typed `behaverse:SimulatedActor`, with its planted accuracies written in the study.

Since the pool always answers, a study draws the answer that never comes for whoever takes its place: a timer
boundary event on the step that asks, or on the sub-process around it, as `simulated_screening` does.

`test_local.py` is the runner's self-check.
