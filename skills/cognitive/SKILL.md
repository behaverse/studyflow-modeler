---
name: cognitive
description: "Cognitive and behavioral research vocabulary: cognitive tasks, questionnaires, instructions, rest periods, screening and allocation gateways, participant pools. Use when a study measures people or agents with tasks and questionnaires."
license: MIT
metadata:
  schema: "cognitive.moddle.yaml"
  runtimes:
    browser: "browser/index.tsx"
---

The default research elements. `Instruction` and `Questionnaire` are screens of this skill's own in the browser
runtime (`browser/`); `behaverse:Task` is executed by the [behaverse](../behaverse/SKILL.md) skill's runners. A study
that needs none of it can turn the skill off.
