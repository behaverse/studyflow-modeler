---
name: cognitive
description: "Cognitive and behavioral research vocabulary: cognitive tasks, questionnaires, instructions, rest periods, screening and allocation gateways, participant pools. Use when a study measures people or agents with tasks and questionnaires."
license: MIT
metadata:
  schema: "cognitive.moddle.yaml"
  runtimes:
    browser: "browser/index.tsx"
---

The default research elements, and the two messages a task exchanges with whoever takes it, whichever software
plays it: `cognitive:Trial` out of the task and `cognitive:Response` back (a message flow's `structureRef`, through its
`messageRef` and the message's `itemRef`). `Instruction`, `Questionnaire` and `Rest` are screens of this skill's own in the
browser runtime (`browser/`): a rest is a timer event the walk waits on, and its screen tells the participant how to
rest (`eyes`) while the time left counts down, and a rest kept with closed eyes ends with a tone. `behaverse:Task` is executed by the [behaverse](../behaverse/SKILL.md)
skill's runners. A study that needs none of it can turn the skill off.
