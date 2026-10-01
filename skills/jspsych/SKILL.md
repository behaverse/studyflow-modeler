---
name: jspsych
description: "Opens a jsPsych timeline (a .json export of its trials) in the modeler as a studyflow of cognitive tasks, one per plugin node, with its consent form detected, and plays a `jspsych://` step in the browser runtime. Use when a study already exists as a jsPsych experiment, or runs jsPsych plugins."
license: MIT
compatibility: "The browser runtime; the jsPsych builds load from unpkg."
metadata:
  schemes: "jspsych"
  runtimes:
    browser: "browser/index.tsx"
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
