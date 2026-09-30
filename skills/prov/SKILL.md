---
name: prov
description: "What a run leaves behind: the run repository, the records, and the prov timeline written back into the diagram. Use when reading or reasoning about what a study run recorded."
license: MIT
compatibility: "The module runs inside the local runtime (git for the run repository)."
metadata:
  schema: "prov.moddle.yaml"
---

`prov.moddle.yaml` is the vocabulary a run writes back into the diagram (records, the state tree's
`_meta`). `prov.ts` is the module the [local runtime](../local/SKILL.md) imports to keep the
run repository and its records. The modeler's provenance panel reads the same records. The `prov:` prefix is
this skill's own vocabulary, not W3C PROV: `w3c.ts` writes a run's record, its `events.jsonl`, as W3C PROV-O
(`studyflow prov <run>`).
