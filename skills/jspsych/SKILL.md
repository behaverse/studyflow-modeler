---
name: jspsych
description: "Opens a jsPsych timeline (a .json export of its trials) in the modeler as a studyflow of cognitive tasks, one per plugin node, with its consent form detected. Use when a study already exists as a jsPsych experiment."
license: MIT
metadata:
  modeler: "modeler.ts"
---

Import only. "Open File..." in the modeler takes a `.json` jsPsych timeline and converts it on
the way in: each timeline node becomes a `cognitive:CognitiveTask` with `instrument: jspsych`,
its plugin bound as a `https://github.com/jspsych/...` implementation and its parameters kept as
the task's configurations; a consent plugin becomes the study's consent form. Nothing here
writes a timeline back.
