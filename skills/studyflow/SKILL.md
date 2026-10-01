---
name: studyflow
description: "The core studyflow notation: studies, tasks, data, state, execution, and the sequence between them, as a BPMN extension. Use when authoring, reading, or validating any studyflow diagram."
license: MIT
metadata:
  schema: "studyflow.moddle.yaml, prov.moddle.yaml"
---

The vocabulary every diagram is written in. `studyflow.moddle.yaml` declares the app-wide powers
(the inspector tab set, `bpmn:*` redefines, expression traits) that no other skill copies; the schema
authoring reference is [../SCHEMAS.md](../SCHEMAS.md). Its elements are executed by the
[browser](../../packages/runtime-browser) and [local](../../packages/runtime-local) runtimes themselves.

`prov.moddle.yaml` is the vocabulary a run writes back into the diagram: the records it stamps on what it ran
(`prov:Activity`) and the state tree's `_meta`. The `prov:` prefix is Studyflow's own, not W3C PROV; a run's record
is written as W3C PROV-O by `studyflow prov <run>`. The local runtime keeps the run repository the records point at.

`examples/` holds the demos every shelf of the gallery starts from (LabLink, CONSORT and SPIRIT
protocols, the kitchen sink).
