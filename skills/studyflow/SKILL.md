---
name: studyflow
description: "The core studyflow notation: studies, tasks, data, state, execution, and the sequence between them, as a BPMN extension. Use when authoring, reading, or validating any studyflow diagram."
license: MIT
metadata:
  schema: "studyflow.moddle.yaml, prov.moddle.yaml"
---

The vocabulary every diagram is written in. Its elements are executed by the
[browser](../../packages/runtime-browser) and [local](../../packages/runtime-local) runtimes themselves.

```yaml
Demo0_FromScratch:
  type: Process
  name: EPSYLON LabLink - Build a study from scratch
  extensions:
    studyflow:Study: {}
  elements:
    Start:
      type: StartEvent
      name: Participant arrives

    End:
      type: EndEvent
      name: Done

    Flow_Start_End:
      source: $Start
      target: $End
```

## Schemas

- `studyflow.moddle.yaml` declares the app-wide powers that no other skill copies: the inspector tab set, the
  `bpmn:*` redefines, and the expression traits. The schema authoring reference is [../SCHEMAS.md](../SCHEMAS.md).
- `prov.moddle.yaml` is the vocabulary a run writes back into the diagram: the records it stamps on what it ran
  (`prov:Activity`) and the state tree's `_meta`. The `prov:` prefix is Studyflow's own, not W3C PROV.

## A run's record

The local runtime keeps the run repository the records point at. Three commands write a run's record in a standard
form.

| Command | Writes |
| --- | --- |
| `studyflow prov <run>` | The record as W3C PROV-O. |
| `studyflow crate` | The record packaged with its files as a Workflow Run RO-Crate. |
| `studyflow ocel` | The record as an OCEL 2.0 event log. |

## Examples

`examples/` holds the demos every shelf of the gallery starts from (LabLink, the kitchen sink). The CONSORT and
SPIRIT protocols ship with the [reporting-guidelines](../reporting-guidelines/SKILL.md) skill, which draws their
documents.
