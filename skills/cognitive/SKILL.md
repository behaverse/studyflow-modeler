---
name: cognitive
description: "Cognitive and behavioral research vocabulary: cognitive tasks, questionnaires, instructions, rest periods, screening and allocation gateways, participant pools. Use when a study measures people or agents with tasks and questionnaires."
license: MIT
metadata:
  schema: "cognitive.moddle.yaml"
  runtimes:
    browser: "browser/index.tsx"
---

The default research elements, and the two messages a task exchanges with whoever takes it. A study that needs none
of them can turn the skill off.

```yaml
Baseline:
  type: IntermediateCatchEvent
  name: Resting baseline
  timer: PT2M
  extensions:
    cognitive:Rest:
      eyes: closed

Survey:
  type: ChoreographyTask
  name: Post-battery survey
  extensions:
    cognitive:Questionnaire:
      instrument: nasa-tlx
```

## Exchanges

A cognitive task and a questionnaire are exchanges (choreography tasks).

- The upper band is what presents them: the task's `platform`, the questionnaire's `instrument`.
- The lower band is the actor who takes them (`participantRef`).
- A band that names a pool a program answers (a model, a simulated actor) is the exchange with that pool, with no
  message flow drawn. Each trial, or the questionnaire with what is wired into it, goes to the pool, and its answer
  comes back, as along a pair of message flows.
- A task that names no one is drawn as a plain task, and exchanges along the message flows around it, if any.

## Messages

Whichever software plays a task, the task sends `cognitive:Trial` and takes `cognitive:Response` back. Each is a
message flow's `structureRef`, reached through the flow's `messageRef` and the message's `itemRef`.

## Running

- `Instruction`, `Questionnaire` and `Rest` are this skill's own screens in the browser runtime (`browser/`).
- A rest is a timer event the walk waits on. Its screen tells the participant how to rest (`eyes`) while the time
  left counts down, and a rest kept with closed eyes ends with a tone.
- `behaverse:Task` is executed by the [behaverse](../behaverse/SKILL.md) skill's runners.
