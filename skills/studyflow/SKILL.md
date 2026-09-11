---
name: studyflow
description: "The core studyflow notation: studies, tasks, data, state, execution, and the sequence between them, as a BPMN extension. Use when authoring, reading, or validating any studyflow diagram."
license: MIT
metadata:
  schema: "studyflow.moddle.yaml"
---

The vocabulary every diagram is written in. `studyflow.moddle.yaml` declares the app-wide powers
(the inspector tab set, `bpmn:*` redefines, expression traits) that no other skill copies; the schema
authoring reference is [../SCHEMAS.md](../SCHEMAS.md). Its elements are executed by the
[browser](../browser/SKILL.md) and [local](../local/SKILL.md) runtimes themselves.

`examples/` holds the demos every shelf of the gallery starts from (LabLink, CONSORT and SPIRIT
protocols, the kitchen sink).
